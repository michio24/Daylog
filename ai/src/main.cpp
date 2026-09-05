#include <array>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <random>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fs = std::filesystem;

class TempFile {
 public:
  explicit TempFile(fs::path path) : path_(std::move(path)) {}
  ~TempFile() { std::error_code error; fs::remove(path_, error); }
  const fs::path& path() const { return path_; }
 private:
  fs::path path_;
};

static std::string json_string(const std::string& source, const std::string& key) {
  const auto marker = "\"" + key + "\"";
  auto p = source.find(marker);
  if (p == std::string::npos || (p = source.find(':', p + marker.size())) == std::string::npos) throw std::runtime_error("missing field: " + key);
  p = source.find('"', p + 1); if (p == std::string::npos) throw std::runtime_error("invalid JSON string");
  std::string out;
  for (++p; p < source.size(); ++p) { char c = source[p]; if (c == '"') return out; if (c == '\\' && ++p < source.size()) { const char e=source[p]; if(e=='n')out+='\n';else if(e=='r')out+='\r';else if(e=='t')out+='\t';else out+=e; } else out += c; }
  throw std::runtime_error("unterminated JSON string");
}

static std::string json_object(const std::string& source, const std::string& key) {
  const auto marker = "\"" + key + "\"";
  auto p = source.find(marker);
  if (p == std::string::npos || (p = source.find(':', p + marker.size())) == std::string::npos) throw std::runtime_error("missing object: " + key);
  p = source.find_first_not_of(" \t\r\n", p + 1);
  if (p == std::string::npos || source[p] != '{') throw std::runtime_error("invalid JSON object: " + key);
  const auto start = p;
  int depth = 0;
  bool in_string = false, escaped = false;
  for (; p < source.size(); ++p) {
    const char c = source[p];
    if (in_string) {
      if (escaped) escaped = false;
      else if (c == '\\') escaped = true;
      else if (c == '"') in_string = false;
      continue;
    }
    if (c == '"') in_string = true;
    else if (c == '{') ++depth;
    else if (c == '}' && --depth == 0) return source.substr(start, p - start + 1);
  }
  throw std::runtime_error("unterminated JSON object: " + key);
}

static std::string escape_json(const std::string& value) {
  std::string out; for (char c:value) { switch(c){case '"':out+="\\\"";break;case '\\':out+="\\\\";break;case '\n':out+="\\n";break;case '\r':out+="\\r";break;case '\t':out+="\\t";break;default:out+=c;} } return out;
}

static int json_integer(const std::string& source, const std::string& key, int fallback) {
  const auto marker = "\"" + key + "\"";
  auto p = source.find(marker);
  if (p == std::string::npos || (p = source.find(':', p + marker.size())) == std::string::npos) return fallback;
  p = source.find_first_not_of(" \t\r\n", p + 1);
  if (p == std::string::npos || source.compare(p, 4, "null") == 0) return fallback;
  try { return std::stoi(source.substr(p)); } catch (...) { return fallback; }
}

#ifndef _WIN32
static std::string quote_arg(const fs::path& path) {
  auto value=path.string(); if(value.find('"')!=std::string::npos)throw std::runtime_error("path contains an invalid quote"); return "\""+value+"\"";
}
#endif

static std::string path_utf8(const fs::path& path) {
#ifdef _WIN32
  const auto value=path.u8string(); return {reinterpret_cast<const char*>(value.data()),value.size()};
#else
  return path.string();
#endif
}

#ifdef _WIN32
static std::wstring utf8_to_wide(const std::string& value) {
  if (value.empty()) return {};
  const int size=MultiByteToWideChar(CP_UTF8,0,value.data(),static_cast<int>(value.size()),nullptr,0);
  if (size<=0) throw std::runtime_error("failed to convert process argument to UTF-16");
  std::wstring result(static_cast<size_t>(size),L'\0');
  MultiByteToWideChar(CP_UTF8,0,value.data(),static_cast<int>(value.size()),result.data(),size);
  return result;
}

static std::wstring quote_windows_arg(const std::wstring& value) {
  if (value.find_first_of(L" \t\n\v\"")==std::wstring::npos) return value;
  std::wstring result=L"\"";
  size_t slashes=0;
  for (const wchar_t c:value) {
    if (c==L'\\') { ++slashes; continue; }
    if (c==L'\"') { result.append(slashes*2+1,L'\\'); result+=c; slashes=0; continue; }
    result.append(slashes,L'\\'); slashes=0; result+=c;
  }
  result.append(slashes*2,L'\\');
  return result+L"\"";
}

static std::pair<int,std::string> run_process(const fs::path& executable, const std::vector<std::string>& args) {
  std::wstring command=quote_windows_arg(executable.wstring());
  for (const auto& arg:args) command+=L" "+quote_windows_arg(utf8_to_wide(arg));
  std::vector<wchar_t> command_buffer(command.begin(),command.end()); command_buffer.push_back(L'\0');

  SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES),nullptr,TRUE};
  HANDLE read_handle=nullptr, write_handle=nullptr;
  if(!CreatePipe(&read_handle,&write_handle,&security,0))throw std::runtime_error("failed to create llama.cpp output pipe");
  SetHandleInformation(read_handle,HANDLE_FLAG_INHERIT,0);

  STARTUPINFOW startup{}; startup.cb=sizeof(startup); startup.dwFlags=STARTF_USESTDHANDLES;
  startup.hStdInput=GetStdHandle(STD_INPUT_HANDLE); startup.hStdOutput=write_handle; startup.hStdError=GetStdHandle(STD_ERROR_HANDLE);
  PROCESS_INFORMATION process{};
  const auto working_directory=executable.parent_path().wstring();
  const BOOL started=CreateProcessW(executable.c_str(),command_buffer.data(),nullptr,nullptr,TRUE,CREATE_NO_WINDOW,nullptr,working_directory.c_str(),&startup,&process);
  CloseHandle(write_handle);
  if(!started){const auto error=GetLastError();CloseHandle(read_handle);throw std::runtime_error("failed to start llama.cpp (Windows error "+std::to_string(error)+")");}

  std::string output; std::array<char,4096> buffer{}; DWORD read=0;
  while(ReadFile(read_handle,buffer.data(),static_cast<DWORD>(buffer.size()),&read,nullptr)&&read>0)output.append(buffer.data(),read);
  CloseHandle(read_handle); WaitForSingleObject(process.hProcess,INFINITE);
  DWORD exit_code=1; GetExitCodeProcess(process.hProcess,&exit_code); CloseHandle(process.hThread); CloseHandle(process.hProcess);
  return {static_cast<int>(exit_code),std::move(output)};
}
#else
static std::pair<int,std::string> run_process(const fs::path& executable, const std::vector<std::string>& args) {
  std::string command=quote_arg(executable);
  for(const auto& arg:args){if(arg.find('\'')!=std::string::npos)throw std::runtime_error("process argument contains an invalid quote");command+=" '"+arg+"'";}
  FILE* pipe=popen(command.c_str(),"r"); if(!pipe)throw std::runtime_error("failed to start llama.cpp");
  std::string output; std::array<char,4096> buffer{}; while(fgets(buffer.data(),static_cast<int>(buffer.size()),pipe))output+=buffer.data();
  return {pclose(pipe),std::move(output)};
}
#endif

static std::string extract_json(std::string text) {
  const auto fence=text.find("```json"); if(fence!=std::string::npos) text=text.substr(fence+7);
  const auto first=text.find('{'), last=text.rfind('}'); if(first==std::string::npos||last==std::string::npos||last<=first)throw std::runtime_error("model did not return JSON"); return text.substr(first,last-first+1);
}

int main(int argc,char** argv) {
  try {
    std::ostringstream input; input << std::cin.rdbuf(); const auto request=input.str();
    const auto request_id=json_string(request,"request_id"); const fs::path configured_model=json_string(request,"model_path");
    const auto backend=json_string(request,"backend"); const auto generation_length=json_string(request,"generation_length");
    const auto day=json_object(request,"day");
    const int context_size=json_integer(request,"context_size",8192);
    if(!fs::exists(configured_model)||configured_model.extension()!=".gguf")throw std::runtime_error("GGUF model was not found");
    const fs::path model=fs::absolute(configured_model).lexically_normal();
    const fs::path self=fs::absolute(argc>0?argv[0]:"daylog-ai.exe");
#ifdef _WIN32
    const fs::path llama=self.parent_path()/"runtime"/"llama-completion.exe";
#else
    const fs::path llama=self.parent_path()/"runtime"/"llama-completion";
#endif
    if(!fs::exists(llama))throw std::runtime_error("llama.cpp completion runtime was not found beside daylog-ai");
    TempFile prompt_file(fs::temp_directory_path()/("daylog_prompt_"+request_id+".txt"));
    const auto& prompt_path=prompt_file.path();
    {
      std::ofstream prompt(prompt_path,std::ios::binary);
      if(!prompt)throw std::runtime_error("failed to create the temporary prompt file");
      prompt << "あなたは個人用デイリージャーナルの整理アシスタントです。入力に明記された事実だけを使ってください。\n"
             << "入力にない出来事、成果、感情、理由、評価、予定を推測または補完してはいけません。一般論や励ましも追加しないでください。\n"
             << "tasks は予定の記録です。completed が false のタスクを実行済みの出来事として書いてはいけません。completed が true の場合も、完了済みと記録されていることだけを述べてください。\n"
             << "タスクしか記録されていない場合は、そのタスクだけを要約してください。タスク名の意味から実行した時間帯、状況、結果を推測してはいけません。\n"
             << "根拠がない場合、achievements と tomorrow_candidates は空配列にしてください。summary と one_line も、記録された内容の範囲だけで簡潔に書いてください。\n"
             << "summary, one_line, achievements, tomorrow_candidates を持つJSONオブジェクトだけを返してください。\n\n日記データ:\n" << day;
    }
    std::cerr << "loading model\n";
    const int max_tokens=generation_length=="短め"?384:generation_length=="長め"?1536:768;
    const std::string schema=R"({"type":"object","properties":{"summary":{"type":"string"},"one_line":{"type":"string"},"achievements":{"type":"array","items":{"type":"string"}},"tomorrow_candidates":{"type":"array","items":{"type":"string"}}},"required":["summary","one_line","achievements","tomorrow_candidates"],"additionalProperties":false})";
    std::vector<std::string> args={"-m",path_utf8(model),"-f",path_utf8(prompt_path),"--no-display-prompt","--single-turn","--reasoning","off","--json-schema",schema,"-n",std::to_string(max_tokens),"-c",std::to_string(context_size),"--temp","0.2"};
    if(backend=="CPU")args.insert(args.end(),{"-ngl","0"});
    else if(backend=="Vulkan")args.insert(args.end(),{"--device","Vulkan0","-ngl","all"});
    else if(backend=="CUDA")args.insert(args.end(),{"--device","CUDA0","-ngl","all"});
    else args.insert(args.end(),{"-ngl","auto"});
    const auto [code,generated]=run_process(llama,args);
    if(code!=0)throw std::runtime_error("llama.cpp inference failed");
    const auto result=extract_json(generated);
    std::cout << "{\"schema_version\":1,\"request_id\":\"" << escape_json(request_id) << "\",\"status\":\"ok\",\"result\":" << result << ",\"runtime\":{\"model\":\"" << escape_json(model.filename().string()) << "\",\"backend\":\"llama.cpp\"}}";
    return 0;
  } catch(const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}

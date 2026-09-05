#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::CloseHandle,
    System::{
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
        Threading::{OpenProcess, PROCESS_ALL_ACCESS},
    },
};

#[cfg(windows)]
pub struct JobObject(pub isize);
#[cfg(windows)]
unsafe impl Send for JobObject {}
#[cfg(windows)]
impl JobObject {
    pub fn assign(pid: u32) -> Result<Self, String> {
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return Err("CreateJobObjectW failed".into());
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as _,
                std::mem::size_of_val(&info) as u32,
            ) == 0
            {
                CloseHandle(job);
                return Err("SetInformationJobObject failed".into());
            }
            let process = OpenProcess(PROCESS_ALL_ACCESS, 0, pid);
            if process.is_null() {
                CloseHandle(job);
                return Err("OpenProcess failed".into());
            }
            let ok = AssignProcessToJobObject(job, process);
            CloseHandle(process);
            if ok == 0 {
                CloseHandle(job);
                return Err("AssignProcessToJobObject failed".into());
            }
            Ok(Self(job as isize))
        }
    }
    pub fn terminate(&self) {
        unsafe {
            TerminateJobObject(self.0 as _, 1);
        }
    }
}
#[cfg(windows)]
impl Drop for JobObject {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0 as _);
        }
    }
}

#[cfg(not(windows))]
pub struct JobObject;
#[cfg(not(windows))]
impl JobObject {
    pub fn assign(_pid: u32) -> Result<Self, String> {
        Ok(Self)
    }
    pub fn terminate(&self) {}
}

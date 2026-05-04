use daemon_core::ports::LaunchSpec;

pub fn resolve_cwd(spec: &LaunchSpec) -> String {
    spec.cwd.clone()
}

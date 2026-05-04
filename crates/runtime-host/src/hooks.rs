use daemon_core::ports::LaunchSpec;

pub fn build_bootstrap_prompt(spec: &LaunchSpec) -> Option<String> {
    spec.bootstrap_prompt.clone()
}

pub fn build_user_prompt(spec: &LaunchSpec) -> Option<String> {
    spec.user_prompt.clone()
}

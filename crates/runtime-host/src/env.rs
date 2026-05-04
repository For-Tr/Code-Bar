use std::collections::HashMap;

use daemon_core::ports::LaunchSpec;

pub fn build_launch_env(spec: &LaunchSpec) -> HashMap<String, String> {
    let mut env = HashMap::new();
    env.insert("TERM".to_string(), "xterm-256color".to_string());
    env.insert("COLORTERM".to_string(), "truecolor".to_string());
    env.extend(spec.env.clone());
    env
}

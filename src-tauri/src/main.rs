// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if code_bar_lib::memory::headless(&std::env::args().collect::<Vec<_>>()) {
        return;
    }
    code_bar_lib::run()
}

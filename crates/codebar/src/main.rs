use codebar_contracts::domain::ProviderKind;
use codebar_contracts::errors::ErrorEnvelope;
use codebar_contracts::rpc::{
    CreateSessionInput, CreateSessionOutput, GetSessionInput, GetSessionOutput, LaunchSessionInput,
    LaunchSessionOutput, ListSessionsInput, ListSessionsOutput, PrepareWorktreeInput,
    PrepareWorktreeOutput, ResumeSessionInput, ResumeSessionOutput, WorktreeStrategy,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RpcRequest {
    id: Option<String>,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RpcResponse {
    id: Option<String>,
    ok: bool,
    result: Option<Value>,
    error: Option<ErrorEnvelope>,
}

fn main() {
    if let Err(message) = run(std::env::args().collect()) {
        eprintln!("{message}");
        std::process::exit(1);
    }
}

fn run(args: Vec<String>) -> Result<(), String> {
    if args.len() < 3 || args[1] != "task" {
        return Err(usage());
    }

    match args[2].as_str() {
        "open" => cmd_task_open(&args[3..]),
        "resume" => cmd_task_resume(&args[3..]),
        "status" => cmd_task_status(&args[3..]),
        _ => Err(usage()),
    }
}

fn cmd_task_open(args: &[String]) -> Result<(), String> {
    if args.is_empty() {
        return Err("missing taskId\n\n".to_string() + &usage());
    }
    let task_id = args[0].clone();
    let provider = parse_provider_flag(args)?;

    let create_response: CreateSessionOutput = rpc_call(
        "createSession",
        CreateSessionInput {
            task_id,
            provider,
            worktree_strategy: WorktreeStrategy::NewManaged,
        },
    )?;

    let _prepared_worktree: PrepareWorktreeOutput = rpc_call(
        "prepareWorktree",
        PrepareWorktreeInput {
            session_id: create_response.session.id.clone(),
            strategy: WorktreeStrategy::NewManaged,
        },
    )?;

    let launch_response: LaunchSessionOutput = rpc_call(
        "launchSession",
        LaunchSessionInput {
            session_id: create_response.session.id.clone(),
        },
    )?;

    println!(
        "session={} state={:?} run={}",
        launch_response.session.id, launch_response.session.state, launch_response.run.id
    );
    Ok(())
}

fn cmd_task_resume(args: &[String]) -> Result<(), String> {
    if args.is_empty() {
        return Err("missing taskId|sessionId\n\n".to_string() + &usage());
    }
    let target = args[0].clone();
    let provider = parse_provider_flag(args)?;

    let session_id = if looks_like_session_id(&target) {
        target
    } else if let Some(existing_session_id) = latest_session_id_for_task(&target)? {
        existing_session_id
    } else {
        let create_response: CreateSessionOutput = rpc_call(
            "createSession",
            CreateSessionInput {
                task_id: target,
                provider,
                worktree_strategy: WorktreeStrategy::NewManaged,
            },
        )?;
        create_response.session.id
    };

    let _prepared_worktree: PrepareWorktreeOutput = rpc_call(
        "prepareWorktree",
        PrepareWorktreeInput {
            session_id: session_id.clone(),
            strategy: WorktreeStrategy::NewManaged,
        },
    )
    .or_else(|_| {
        rpc_call(
            "prepareWorktree",
            PrepareWorktreeInput {
                session_id: session_id.clone(),
                strategy: WorktreeStrategy::Reuse,
            },
        )
    })?;

    let resume_response: ResumeSessionOutput = rpc_call(
        "resumeSession",
        ResumeSessionInput {
            session_id: session_id.clone(),
        },
    )
    .or_else(|_| {
        rpc_call(
            "launchSession",
            LaunchSessionInput {
                session_id: session_id.clone(),
            },
        )
        .map(|output: LaunchSessionOutput| ResumeSessionOutput {
            session: output.session,
            run: output.run,
        })
    })?;

    println!(
        "session={} state={:?} run={}",
        resume_response.session.id, resume_response.session.state, resume_response.run.id
    );
    Ok(())
}

fn cmd_task_status(args: &[String]) -> Result<(), String> {
    if args.is_empty() {
        return Err("missing taskId|sessionId\n\n".to_string() + &usage());
    }
    let target = args[0].clone();

    let session_id = if looks_like_session_id(&target) {
        target
    } else {
        latest_session_id_for_task(&target)?
            .ok_or_else(|| format!("no session found for task {}", target))?
    };

    let output: GetSessionOutput = rpc_call(
        "getSession",
        GetSessionInput {
            session_id: session_id.clone(),
        },
    )?;

    println!(
        "session={} task={} state={:?} provider={:?}",
        output.session.id, output.session.task_id, output.session.state, output.session.provider
    );
    Ok(())
}

fn parse_provider_flag(args: &[String]) -> Result<ProviderKind, String> {
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        if arg == "--provider" {
            let Some(value) = iter.next() else {
                return Err("missing provider value".to_string());
            };
            return match value.as_str() {
                "claude" => Ok(ProviderKind::Claude),
                "codex" => Ok(ProviderKind::Codex),
                _ => Err("provider must be claude|codex".to_string()),
            };
        }
    }
    Ok(ProviderKind::Claude)
}

fn looks_like_session_id(value: &str) -> bool {
    value.chars().all(|ch| ch.is_ascii_digit()) || value.starts_with("session-")
}

fn latest_session_id_for_task(task_id: &str) -> Result<Option<String>, String> {
    let output: ListSessionsOutput = rpc_call(
        "listSessions",
        ListSessionsInput {
            task_id: Some(task_id.to_string()),
            workspace_id: None,
            session_id: None,
        },
    )?;
    Ok(output.sessions.into_iter().last().map(|session| session.id))
}

fn rpc_call<TIn, TOut>(method: &str, params: TIn) -> Result<TOut, String>
where
    TIn: serde::Serialize,
    TOut: for<'de> serde::Deserialize<'de>,
{
    let socket_path = daemon_socket_path();

    #[cfg(unix)]
    {
        use std::os::unix::net::UnixStream;
        let mut stream = UnixStream::connect(&socket_path)
            .map_err(|error| format!("failed to connect {}: {error}", socket_path.display()))?;
        let request = RpcRequest {
            id: Some("codebar-cli".to_string()),
            method: method.to_string(),
            params: serde_json::to_value(params).map_err(|error| error.to_string())?,
        };
        let encoded = serde_json::to_string(&request).map_err(|error| error.to_string())?;
        stream
            .write_all(format!("{encoded}\n").as_bytes())
            .map_err(|error| error.to_string())?;
        let mut reader = BufReader::new(stream);
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .map_err(|error| error.to_string())?;
        let response: RpcResponse =
            serde_json::from_str(&line).map_err(|error| error.to_string())?;
        if response.ok {
            serde_json::from_value(response.result.unwrap_or(Value::Null))
                .map_err(|error| error.to_string())
        } else {
            let message = response
                .error
                .map(|error| format!("{:?}: {}", error.code, error.message))
                .unwrap_or_else(|| "unknown rpc error".to_string());
            Err(message)
        }
    }

    #[cfg(not(unix))]
    {
        let _ = method;
        let _ = params;
        let _ = socket_path;
        Err("codebar CLI currently supports unix sockets only".to_string())
    }
}

fn daemon_socket_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home)
        .join(".codebar")
        .join("codebard")
        .join("codebard.sock")
}

fn usage() -> String {
    [
        "usage:",
        "  codebar task open <taskId> --provider <claude|codex>",
        "  codebar task resume <taskId|sessionId> --provider <claude|codex>",
        "  codebar task status <taskId|sessionId>",
    ]
    .join("\n")
}

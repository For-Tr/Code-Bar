use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub type Result<T> = std::result::Result<T, String>;
pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
pub fn hash(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}
pub fn field<'a>(v: &'a Value, name: &str) -> &'a str {
    v.get(name).and_then(Value::as_str).unwrap_or("")
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub enabled: bool,
    pub base_url: String,
    pub api_key: String,
    pub auto_collect: bool,
    #[serde(default = "default_llm_base_url")]
    pub llm_base_url: String,
    #[serde(default = "default_llm_model")]
    pub llm_model: String,
}
fn default_llm_base_url() -> String {
    "https://api.deepseek.com/v1".into()
}
fn default_llm_model() -> String {
    "deepseek-chat".into()
}
impl Default for Config {
    fn default() -> Self {
        Self {
            enabled: false,
            base_url: "http://127.0.0.1:8888".into(),
            api_key: String::new(),
            auto_collect: true,
            llm_base_url: default_llm_base_url(),
            llm_model: default_llm_model(),
        }
    }
}
impl Config {
    pub fn public(&self) -> Value {
        json!({"enabled":self.enabled,"baseUrl":self.base_url,"hasApiKey":!self.api_key.is_empty(),"autoCollect":self.auto_collect,"llmBaseUrl":self.llm_base_url,"llmModel":self.llm_model,"managedLocal":is_local_url(&self.base_url)})
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    pub token: String,
    pub repo_id: String,
    pub session_id: String,
    pub task_id: String,
    pub workspace_path: String,
    pub worktree_path: String,
    pub runner_type: String,
    pub provider_session_id: String,
    pub provider_root: String,
}
pub struct Store {
    pub db: Connection,
}
impl Store {
    pub fn open(dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(dir).map_err(err)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)).map_err(err)?;
        }
        let db = Connection::open(dir.join("memory.sqlite3")).map_err(err)?;
        db.busy_timeout(Duration::from_secs(5)).map_err(err)?;
        db.execute_batch("PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS repos (identity TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE);
          CREATE TABLE IF NOT EXISTS bindings (token TEXT PRIMARY KEY, repo TEXT NOT NULL, session TEXT NOT NULL, json TEXT NOT NULL, UNIQUE(repo,session));
          CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, repo TEXT NOT NULL, task TEXT NOT NULL, kind TEXT NOT NULL, locator TEXT NOT NULL, content TEXT NOT NULL, scope TEXT NOT NULL, metadata TEXT NOT NULL, created INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_retry INTEGER NOT NULL DEFAULT 0, error TEXT, invalid INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1);
          CREATE INDEX IF NOT EXISTS source_scope ON sources(repo,task,scope);
          CREATE TABLE IF NOT EXISTS cursors (id TEXT PRIMARY KEY, value TEXT NOT NULL);").map_err(err)?;
        Ok(Self { db })
    }
    pub fn config(&self) -> Result<Config> {
        let s: Option<String> = self
            .db
            .query_row("SELECT json FROM settings WHERE id=1", [], |r| r.get(0))
            .optional()
            .map_err(err)?;
        s.map(|s| serde_json::from_str(&s).map_err(err))
            .unwrap_or_else(|| Ok(Config::default()))
    }
    pub fn configure(&self, v: &Value) -> Result<Value> {
        let tx = rusqlite::Transaction::new_unchecked(
            &self.db,
            rusqlite::TransactionBehavior::Immediate,
        )
        .map_err(err)?;
        let previous = self.config()?;
        let mut c = previous.clone();
        if let Some(x) = v.get("enabled").and_then(Value::as_bool) {
            c.enabled = x;
        }
        if let Some(x) = v.get("autoCollect").and_then(Value::as_bool) {
            c.auto_collect = x;
        }
        if let Some(x) = v.get("baseUrl").and_then(Value::as_str) {
            let url = reqwest::Url::parse(x.trim()).map_err(err)?;
            if !matches!(url.scheme(), "http" | "https")
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
            {
                return Err(
                    "Use an HTTP(S) service URL without credentials, query or fragment".into(),
                );
            }
            let next = x.trim().trim_end_matches('/').to_string();
            c.base_url = next;
        }
        if let Some(x) = v.get("apiKey").and_then(Value::as_str) {
            c.api_key = x.trim().into();
        }
        if let Some(x) = v.get("llmBaseUrl").and_then(Value::as_str) {
            let url = reqwest::Url::parse(x.trim()).map_err(err)?;
            if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
                return Err("Use an HTTP(S) model service URL".into());
            }
            c.llm_base_url = x.trim().trim_end_matches('/').to_string();
        }
        if let Some(x) = v.get("llmModel").and_then(Value::as_str) {
            if x.trim().is_empty() || x.len() > 256 {
                return Err("A valid model name is required".into());
            }
            c.llm_model = x.trim().into();
        }
        if c.base_url != previous.base_url
            || c.api_key != previous.api_key
            || c.llm_base_url != previous.llm_base_url
            || c.llm_model != previous.llm_model
        {
            self.db
                .execute(
                    "UPDATE sources SET state='pending',next_retry=0,error=NULL,version=version+1",
                    [],
                )
                .map_err(err)?;
        } else if c.enabled != previous.enabled {
            self.db
                .execute(
                    "UPDATE sources SET next_retry=0,version=version+1 WHERE state!='synced'",
                    [],
                )
                .map_err(err)?;
        }
        self.db.execute("INSERT INTO settings(id,json) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET json=excluded.json",[serde_json::to_string(&c).map_err(err)?]).map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(c.public())
    }
    pub fn register(&self, v: &Value) -> Result<Binding> {
        let workspace = canonical(field(v, "workspacePath"))?;
        let identity = repository_identity(&workspace);
        let tx = rusqlite::Transaction::new_unchecked(
            &self.db,
            rusqlite::TransactionBehavior::Immediate,
        )
        .map_err(err)?;
        self.db
            .execute(
                "INSERT OR IGNORE INTO repos(identity,id) VALUES(?1,?2)",
                params![identity, uuid::Uuid::new_v4().to_string()],
            )
            .map_err(err)?;
        let repo: String = self
            .db
            .query_row("SELECT id FROM repos WHERE identity=?1", [identity], |r| {
                r.get(0)
            })
            .map_err(err)?;
        let session = field(v, "sessionId");
        if session.is_empty() || session.len() > 256 {
            return Err("A valid session ID is required".into());
        }
        let old: Option<String> = self
            .db
            .query_row(
                "SELECT json FROM bindings WHERE repo=?1 AND session=?2",
                params![repo, session],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        let prior: Option<Binding> = old
            .map(|s| serde_json::from_str(&s))
            .transpose()
            .map_err(err)?;
        let wt = if field(v, "worktreePath").is_empty() {
            workspace.clone()
        } else {
            match canonical(field(v, "worktreePath")) {
                Ok(path) => path,
                Err(error) => {
                    if let Some(old) = &prior {
                        if normalized_path(field(v, "worktreePath"))
                            == normalized_path(&old.worktree_path)
                            && !Path::new(&old.worktree_path).exists()
                        {
                            tx.commit().map_err(err)?;
                            return Ok(old.clone());
                        }
                    }
                    return Err(error);
                }
            }
        };
        if repository_identity(&wt) != repository_identity(&workspace) {
            return Err("Worktree does not belong to this repository".into());
        }
        let provider = field(v, "providerSessionId");
        let runner = field(v, "runnerType");
        let binding = Binding {
            token: prior
                .as_ref()
                .map(|b| b.token.clone())
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            task_id: hash(&format!("{repo}:{session}")),
            repo_id: repo,
            session_id: session.into(),
            workspace_path: workspace.to_string_lossy().into(),
            worktree_path: wt.to_string_lossy().into(),
            runner_type: if runner.is_empty() {
                prior
                    .as_ref()
                    .map(|b| b.runner_type.clone())
                    .unwrap_or_default()
            } else {
                runner.into()
            },
            provider_session_id: if provider.is_empty() {
                prior
                    .as_ref()
                    .map(|b| b.provider_session_id.clone())
                    .unwrap_or_default()
            } else {
                provider.into()
            },
            provider_root: if field(v, "providerRoot").is_empty() {
                prior
                    .as_ref()
                    .map(|b| b.provider_root.clone())
                    .unwrap_or_default()
            } else {
                field(v, "providerRoot").into()
            },
        };
        self.db.execute("INSERT INTO bindings(token,repo,session,json) VALUES(?1,?2,?3,?4) ON CONFLICT(repo,session) DO UPDATE SET json=excluded.json",params![binding.token,binding.repo_id,binding.session_id,serde_json::to_string(&binding).map_err(err)?]).map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(binding)
    }
    pub fn binding(&self, token: &str) -> Result<Binding> {
        let s: String = self
            .db
            .query_row("SELECT json FROM bindings WHERE token=?1", [token], |r| {
                r.get(0)
            })
            .map_err(|_| "Unknown memory session".to_string())?;
        serde_json::from_str(&s).map_err(err)
    }
    pub fn bindings(&self) -> Result<Vec<Binding>> {
        let mut st = self.db.prepare("SELECT json FROM bindings").map_err(err)?;
        let rows = st.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        rows.map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
            .collect()
    }
    pub fn enqueue(
        &self,
        b: &Binding,
        kind: &str,
        locator: &str,
        content: &str,
        scope: &str,
        metadata: Value,
    ) -> Result<String> {
        if content.trim().is_empty() || content.len() > 128 * 1024 {
            return Err("Evidence must contain 1–131072 UTF-8 bytes".into());
        }
        if !matches!(scope, "task" | "repo") {
            return Err("Invalid memory scope".into());
        }
        let id = hash(&format!(
            "{}:{}:{kind}:{locator}:{}",
            b.repo_id,
            b.task_id,
            hash(content)
        ));
        let mut meta = metadata.as_object().cloned().unwrap_or_default();
        for (k, v) in [
            ("source_id", id.as_str()),
            ("repo_id", &b.repo_id),
            ("task_id", &b.task_id),
            ("session_id", &b.session_id),
            ("provider_session_id", &b.provider_session_id),
            ("runner", &b.runner_type),
            ("locator", locator),
            ("content_sha256", &hash(content)),
        ] {
            meta.insert(k.into(), json!(v));
        }
        self.db.execute("INSERT OR IGNORE INTO sources(id,repo,task,kind,locator,content,scope,metadata,created) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![id,b.repo_id,b.task_id,kind,locator,content,scope,Value::Object(meta).to_string(),now()]).map_err(err)?;
        Ok(id)
    }
    pub fn source(&self, b: &Binding, id: &str) -> Result<Value> {
        self.db.query_row("SELECT id,kind,locator,scope,state,created,task,content,metadata,version,invalid,repo FROM sources WHERE id=?1 AND repo=?2 AND (task=?3 OR scope='repo' OR ?4='desktop') AND invalid=0",params![id,b.repo_id,b.task_id,b.runner_type],source_row).map_err(|_|"Source unavailable in this task".into())
    }
    #[cfg(test)]
    pub fn sources(&self, b: &Binding) -> Result<Vec<Value>> {
        self.sources_page(b, 0)
    }
    pub fn sources_page(&self, b: &Binding, offset: u64) -> Result<Vec<Value>> {
        let mut st=self.db.prepare("SELECT id,kind,locator,scope,state,created,task,content,metadata,version,invalid,repo FROM sources WHERE repo=?1 AND (task=?2 OR scope='repo' OR ?3='desktop') AND invalid=0 ORDER BY created DESC,id LIMIT 200 OFFSET ?4").map_err(err)?;
        let rows = st
            .query_map(
                params![
                    b.repo_id,
                    b.task_id,
                    b.runner_type,
                    offset.min(i64::MAX as u64) as i64
                ],
                source_row,
            )
            .map_err(err)?;
        rows.map(|r| {
            let mut v = r.map_err(err)?;
            v.as_object_mut().unwrap().remove("content");
            Ok(v)
        })
        .collect()
    }
    pub fn set_scope(&self, b: &Binding, id: &str, scope: &str) -> Result<()> {
        let s = self.source(b, id)?;
        if s["taskId"] != b.task_id && b.runner_type != "desktop" {
            return Err("Only the originating task can share evidence".into());
        }
        self.db.execute("UPDATE sources SET scope=?1,state='pending',next_retry=0,error=NULL,version=version+1 WHERE id=?2",params![scope,id]).map_err(err)?;
        Ok(())
    }
    pub fn invalidate(&self, b: &Binding, id: &str) -> Result<()> {
        self.source(b, id)?;
        self.db.execute("UPDATE sources SET invalid=1,state='pending',next_retry=0,error=NULL,version=version+1 WHERE id=?1",[id]).map_err(err)?;
        Ok(())
    }
    pub fn status(&self, b: &Binding) -> Result<Value> {
        self.db.query_row("SELECT count(*),coalesce(sum(state='pending'),0),coalesce(sum(state='failed'),0),coalesce(sum(state='synced'),0) FROM sources WHERE repo=?1 AND (task=?2 OR scope='repo' OR ?3='desktop')",params![b.repo_id,b.task_id,b.runner_type],|r|Ok(json!({"sources":r.get::<_,i64>(0)?,"pending":r.get::<_,i64>(1)?,"failed":r.get::<_,i64>(2)?,"synced":r.get::<_,i64>(3)?}))).map_err(err).and_then(|mut v|{
            let e:Option<String>=self.db.query_row("SELECT error FROM sources WHERE repo=?1 AND (task=?2 OR scope='repo' OR ?3='desktop') AND error IS NOT NULL ORDER BY next_retry DESC LIMIT 1",params![b.repo_id,b.task_id,b.runner_type],|r|r.get(0)).optional().map_err(err)?;
            v["lastError"]=json!(e);Ok(v)
        })
    }
    pub fn cursor(&self, id: &str) -> Result<String> {
        Ok(self
            .db
            .query_row("SELECT value FROM cursors WHERE id=?1", [id], |r| r.get(0))
            .optional()
            .map_err(err)?
            .unwrap_or_default())
    }
    pub fn save_cursor(&self, id: &str, value: &str) -> Result<()> {
        self.db.execute("INSERT INTO cursors(id,value) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET value=excluded.value",params![id,value]).map_err(err)?;
        Ok(())
    }
    pub fn pending(&self) -> Result<Vec<Value>> {
        let mut st=self.db.prepare("SELECT id,kind,locator,scope,state,created,task,content,metadata,version,invalid,repo FROM sources WHERE state!='synced' AND next_retry<=?1 ORDER BY invalid DESC,created LIMIT 8").map_err(err)?;
        let rows = st.query_map([now()], source_row).map_err(err)?;
        rows.map(|r| r.map_err(err)).collect()
    }
    pub fn delivered(&self, id: &str, version: i64, error: Option<&str>) -> Result<()> {
        if let Some(e) = error {
            self.db.execute("UPDATE sources SET state='failed',attempts=attempts+1,next_retry=?1+min(3600,30*(1 << min(attempts,7))),error=?2 WHERE id=?3 AND version=?4",params![now(),e,id,version]).map_err(err)?;
        } else {
            self.db
                .execute(
                    "UPDATE sources SET state='synced',error=NULL WHERE id=?1 AND version=?2",
                    params![id, version],
                )
                .map_err(err)?;
        }
        Ok(())
    }
}
pub fn is_local_url(url: &str) -> bool {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|u| {
            u.host_str()
                .map(|h| h == "127.0.0.1" || h == "localhost" || h == "::1")
        })
        .unwrap_or(false)
}
fn source_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let metadata: String = r.get(8)?;
    Ok(
        json!({"id":r.get::<_,String>(0)?,"kind":r.get::<_,String>(1)?,"locator":r.get::<_,String>(2)?,"scope":r.get::<_,String>(3)?,"state":r.get::<_,String>(4)?,"createdAt":r.get::<_,i64>(5)?*1000,"taskId":r.get::<_,String>(6)?,"content":r.get::<_,String>(7)?,"metadata":serde_json::from_str::<Value>(&metadata).unwrap_or(json!({})),"version":r.get::<_,i64>(9)?,"invalid":r.get::<_,i64>(10)?!=0,"repoId":r.get::<_,String>(11)?}),
    )
}
pub fn canonical(path: &str) -> Result<PathBuf> {
    if path.trim().is_empty() {
        return Err("Workspace path required".into());
    }
    let p = std::fs::canonicalize(crate::util::expand_path(path)).map_err(err)?;
    if !p.is_dir() {
        return Err("Workspace must be a directory".into());
    }
    Ok(p)
}
pub fn repository_identity(path: &Path) -> String {
    let git = crate::util::background_command("git")
        .current_dir(path)
        .args(["rev-parse", "--path-format=absolute", "--git-common-dir"])
        .output();
    if let Ok(out) = git {
        if out.status.success() {
            if let Ok(p) = std::fs::canonicalize(String::from_utf8_lossy(&out.stdout).trim()) {
                return format!("git:{}", p.to_string_lossy());
            }
        }
    }
    format!("dir:{}", path.to_string_lossy())
}

pub fn normalized_path(path: &str) -> PathBuf {
    let p = PathBuf::from(crate::util::expand_path(path));
    if let Ok(canonical) = std::fs::canonicalize(&p) {
        return canonical;
    }
    if let (Some(parent), Some(name)) = (p.parent(), p.file_name()) {
        if let Ok(parent) = std::fs::canonicalize(parent) {
            return parent.join(name);
        }
    }
    p
}

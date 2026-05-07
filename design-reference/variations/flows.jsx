// Flows: install (cloning state primary), skill detail with bundle sub-rail,
// update flow with re-deploy, settings

const TitleBar = ({ title }) => (
  <div className="wf-titlebar">
    <div className="wf-tlights"><div className="tl"/><div className="tl"/><div className="tl"/></div>
    <div className="wf-title">{title}</div>
    <div style={{ width: 30 }}/>
  </div>
);

// ───── Install — cloning state (primary) ─────
function InstallFlow() {
  return (
    <div className="wf-window wf" style={{ width: 540, height: 480 }}>
      <TitleBar title="Install Skill — installing…"/>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
        <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--ink-faint)', textTransform: 'uppercase' }}>cloning</div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Installing anthropic-skills</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-faint)' }}>from github.com/anthropic/anthropic-skills</div>

        <div style={{ height: 8, background: 'var(--paper-2)', borderRadius: 4, border: '1px solid var(--line)', overflow: 'hidden' }}>
          <div style={{ width: '65%', height: '100%', background: 'var(--accent)' }}/>
        </div>
        <div className="hand" style={{ color: 'var(--ink-faint)' }}>cloning · 65% · ~3s remaining</div>

        <div className="sk-box" style={{ padding: 10, fontFamily: 'var(--mono)', fontSize: 11, lineHeight: 1.7, background: '#1c1c1c', color: '#d8d8d8', borderColor: '#333' }}>
          <div>$ git clone --depth 1 …anthropic-skills</div>
          <div>Cloning into '/tmp/skill-…</div>
          <div>remote: Enumerating objects: 248</div>
          <div style={{ color: 'var(--good)' }}>✓ Cloned · 8a2c1f3</div>
          <div>$ scanning for SKILL.md…</div>
          <div style={{ color: '#fff' }}>found 12 skills <span style={{ color: 'var(--accent)' }}>▌</span></div>
        </div>
        <div className="sk-box" style={{ padding: 10, background: '#f7f6ee', borderStyle: 'dashed' }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--ink-faint)' }}>BUNDLE — 12 skills inside</div>
          <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--ink-soft)', lineHeight: 1.6, marginTop: 4 }}>
            ├ pdf-tools  ├ make-deck  ├ napkin-reader<br/>└ + 9 more (cherry-pick from detail)
          </div>
        </div>
        <div style={{ flex: 1 }}/>
        <div style={{ display: 'flex', gap: 6 }}>
          <span className="sk-btn ghost">Cancel</span>
          <div style={{ flex: 1 }}/>
          <span className="sk-btn" style={{ opacity: 0.5 }}>Done</span>
        </div>
      </div>
      <div className="anno" style={{ top: 240, right: -130, width: 120 }}>
        live log + bundle<br/>preview while<br/>cloning
      </div>
    </div>
  );
}

// ───── Skill detail with deployments rail + bundle sub-option ─────
function SkillDetail() {
  return (
    <div className="wf-window wf" style={{ width: 800, height: 660 }}>
      <TitleBar title="anthropic-skills"/>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 1, padding: 18, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div className="skill-icon" style={{ width: 52, height: 52, fontSize: 22, background: 'var(--paper-2)' }}>📦</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>anthropic-skills</div>
              <div className="hand" style={{ color: 'var(--ink-soft)', fontSize: 16 }}>
                Bundle of 12 first-party skills
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <span className="sk-tag">bundle · 12 inside</span>
                <span className="sk-tag good">up to date</span>
                <span className="sk-tag">@ 8a2c1f3</span>
              </div>
            </div>
          </div>
          <div className="sk-divider soft"/>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--ink-faint)', textTransform: 'uppercase', marginBottom: 4 }}>Source</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>github.com/anthropic/<br/>anthropic-skills</div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--ink-faint)', textTransform: 'uppercase', marginBottom: 4 }}>Installed</div>
              <div style={{ fontSize: 12 }}>2 weeks ago · updated today</div>
            </div>
          </div>
          <div className="sk-divider soft"/>
          {/* SKILLS INSIDE BUNDLE — shown inline as it's a bundle */}
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
              <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--ink-faint)', textTransform: 'uppercase' }}>Skills inside · 12</div>
              <div className="hand" style={{ color: 'var(--ink-faint)', fontSize: 13 }}>tick to deploy in batch</div>
              <div style={{ flex: 1 }}/>
              <span className="sk-btn sm">Select all</span>
            </div>
            <div className="sk-box" style={{ padding: 0, maxHeight: 220, overflow: 'auto' }}>
              {[
                ['pdf-tools', 'parse + render PDFs', true],
                ['make-deck', 'slide decks in HTML', true],
                ['frontend-design', 'aesthetic direction', true],
                ['napkin-reader', 'parse .napkin sketches', false],
                ['wireframe', 'explore design space', false],
                ['pptx-editable', 'native PowerPoint', false],
                ['pdf-export', 'print-ready PDF', false],
              ].map(([n, d, on], i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', borderBottom: i < 6 ? '1px dashed var(--line-soft)' : 'none', gap: 10 }}>
                  <div style={{ width: 14, height: 14, borderRadius: 3, border: '1.5px solid var(--line)', background: on ? 'var(--ink)' : 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 10 }}>{on && '✓'}</div>
                  <div className="skill-icon" style={{ width: 22, height: 22, fontSize: 9 }}>{n.slice(0,1).toUpperCase()}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{n}</div>
                    <div style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{d}</div>
                  </div>
                  <span className="sk-btn sm ghost">›</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* DEPLOYMENTS RAIL with bundle sub-option */}
        <div style={{ width: 240, borderLeft: '1.5px solid var(--line-soft)', padding: 14, background: 'var(--paper-2)', display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto' }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--ink-faint)', textTransform: 'uppercase' }}>Deployed (3)</div>
          {[
            ['~/code/myapp', 'all 12 skills'],
            ['~/code/landing', '3 skills'],
            ['~/work/agents', '7 skills'],
          ].map(([p, sub]) => (
            <div key={p} className="sk-box" style={{ padding: 8, fontSize: 11, fontFamily: 'var(--mono)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p}</span>
                <span style={{ fontSize: 14, color: 'var(--ink-faint)' }}>×</span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--accent)', marginTop: 2, fontFamily: 'var(--read)' }}>{sub}</div>
            </div>
          ))}

          <div className="sk-divider soft"/>
          {/* BUNDLE SUB-OPTION FROM RAIL */}
          <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--ink-faint)', textTransform: 'uppercase' }}>Deploy bundle as</div>
          <div className="sk-box" style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--paper)' }}>
            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', border: '1.5px solid var(--line)', background: 'var(--ink)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'white' }}/>
              </span>
              All skills (full bundle)
            </label>
            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink-soft)' }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', border: '1.5px solid var(--line-soft)' }}/>
              Selected (3 ticked)
            </label>
            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink-soft)' }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', border: '1.5px solid var(--line-soft)' }}/>
              Custom bundle… (save as)
            </label>
          </div>
          <span className="sk-btn sm ghost" style={{ justifyContent: 'center' }}>+ Deploy to project</span>
          <div style={{ flex: 1 }}/>
          <span className="sk-btn">Update from GitHub</span>
          <span className="sk-btn ghost">Browse files</span>
          <span className="sk-btn ghost" style={{ color: 'var(--warn)' }}>Remove</span>
        </div>
      </div>
      <div className="anno" style={{ top: 240, right: -150, width: 140 }}>
        bundle deploy options<br/>live IN the rail —<br/>full / selected / custom
      </div>
    </div>
  );
}

// ───── Updates flow: review → updating → re-deploy ─────
function UpdateReview() {
  const Row = ({ name, from, to, projects, last }) => (
    <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: last ? 'none' : '1px dashed var(--line-soft)', gap: 10 }}>
      <div style={{ width: 16, height: 16, borderRadius: 4, border: '1.5px solid var(--line)', background: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 11 }}>✓</div>
      <div className="skill-icon" style={{ width: 24, height: 24, fontSize: 10 }}>{name.slice(0,1).toUpperCase()}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{name}</div>
        <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--ink-faint)' }}>{from} → <span style={{ color: 'var(--accent)' }}>{to}</span></div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-soft)', fontFamily: 'var(--mono)', textAlign: 'right' }}>cascades to<br/>{projects} projects</div>
    </div>
  );
  return (
    <div className="wf-window wf" style={{ width: 600, height: 580 }}>
      <TitleBar title="Updates available"/>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10, flex: 1, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}><span className="hl">3 updates</span> ready</div>
          <span className="sk-tag mono">step 1 of 3</span>
        </div>
        <div className="hand" style={{ color: 'var(--ink-soft)', fontSize: 16 }}>
          all safe — depth-1 git pulls, will cascade to project copies
        </div>
        <div className="sk-box" style={{ flex: 1, overflow: 'auto', padding: 0 }}>
          <Row name="make-deck" from="3a1f9c2" to="8b4d7e1" projects={3} />
          <Row name="wireframe" from="6b8c2d5" to="7e9f1a3" projects={2} />
          <Row name="canvas-export" from="4e2a8b1" to="9c1d3f4" projects={1} last/>
        </div>
        <div className="sk-box" style={{ padding: 10, background: '#f7f6ee', borderStyle: 'dashed' }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--ink-faint)', textTransform: 'uppercase' }}>Will affect 6 deployments across</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            <span className="sk-tag">~/code/myapp</span>{' '}
            <span className="sk-tag">~/code/landing</span>{' '}
            <span className="sk-tag">~/work/agents</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <span className="sk-btn ghost">Skip all</span>
          <div style={{ flex: 1 }}/>
          <span className="sk-btn">Update only</span>
          <span className="sk-btn primary">Update + re-deploy →</span>
        </div>
      </div>
    </div>
  );
}

function UpdateProgress() {
  const Step = ({ label, state, sub }) => (
    <div style={{ display: 'flex', alignItems: 'center', padding: '8px 0', gap: 10, borderBottom: '1px dashed var(--line-soft)' }}>
      <div style={{ width: 18, height: 18, borderRadius: '50%', border: '1.5px solid var(--line)', background: state === 'done' ? 'var(--good)' : state === 'now' ? 'var(--accent)' : 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 11 }}>
        {state === 'done' && '✓'}
        {state === 'now' && '●'}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: state === 'now' ? 700 : 600, color: state === 'pending' ? 'var(--ink-faint)' : 'var(--ink)' }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--ink-faint)', fontFamily: 'var(--mono)' }}>{sub}</div>}
      </div>
    </div>
  );
  return (
    <div className="wf-window wf" style={{ width: 600, height: 580 }}>
      <TitleBar title="Updating…"/>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10, flex: 1, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Updating + re-deploying</div>
          <span className="sk-tag mono">step 2 of 3</span>
        </div>
        <div style={{ height: 8, background: 'var(--paper-2)', borderRadius: 4, border: '1px solid var(--line)', overflow: 'hidden' }}>
          <div style={{ width: '55%', height: '100%', background: 'var(--accent)' }}/>
        </div>
        <div className="hand" style={{ color: 'var(--ink-faint)' }}>5 of 9 steps · re-deploying to ~/code/landing…</div>
        <div className="sk-box" style={{ padding: '4px 14px', overflow: 'auto', flex: 1 }}>
          <Step label="Pull make-deck" state="done" sub="@ 8b4d7e1 · 1.2s"/>
          <Step label="Pull wireframe" state="done" sub="@ 7e9f1a3 · 0.8s"/>
          <Step label="Pull canvas-export" state="done" sub="@ 9c1d3f4 · 1.0s"/>
          <Step label="Re-deploy → ~/code/myapp" state="done" sub="3 skills replaced"/>
          <Step label="Re-deploy → ~/code/landing" state="now" sub="syncing make-deck, wireframe…"/>
          <Step label="Re-deploy → ~/work/agents" state="pending"/>
          <Step label="Validate SKILL.md frontmatter" state="pending"/>
          <Step label="Save config snapshot" state="pending"/>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <span className="sk-btn ghost">Cancel after current step</span>
          <div style={{ flex: 1 }}/>
          <span className="sk-btn" style={{ opacity: 0.5 }}>Done</span>
        </div>
      </div>
    </div>
  );
}

function UpdateDone() {
  return (
    <div className="wf-window wf" style={{ width: 600, height: 580 }}>
      <TitleBar title="Update complete"/>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12, flex: 1, overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Done — 3 updated, 6 deployments synced</div>
          <span className="sk-tag mono">step 3 of 3</span>
        </div>
        <div className="hand" style={{ color: 'var(--good)', fontSize: 16 }}>✓ all clean — agents will pick up new skills on next run</div>

        <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--ink-faint)', textTransform: 'uppercase' }}>Updated</div>
        <div className="sk-box" style={{ padding: 0 }}>
          {[
            ['make-deck', '3a1f9c2 → 8b4d7e1', '3 deploys synced'],
            ['wireframe', '6b8c2d5 → 7e9f1a3', '2 deploys synced'],
            ['canvas-export', '4e2a8b1 → 9c1d3f4', '1 deploy synced'],
          ].map(([n, c, d], i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: i < 2 ? '1px dashed var(--line-soft)' : 'none', gap: 10 }}>
              <span style={{ color: 'var(--good)', fontSize: 14 }}>✓</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{n}</div>
                <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--ink-faint)' }}>{c}</div>
              </div>
              <span style={{ fontSize: 11, color: 'var(--good)' }}>{d}</span>
            </div>
          ))}
        </div>

        {/* RE-DEPLOY EXTENSION — create new bundle from updated skills */}
        <div className="sk-box shadow" style={{ padding: 12, background: '#fff8d8', borderColor: 'var(--accent)' }}>
          <div className="hand" style={{ fontSize: 18, color: 'var(--accent)', marginBottom: 4 }}>+ create bundle from updates?</div>
          <div style={{ fontSize: 12, marginBottom: 8 }}>Save these 3 freshly-updated skills as a named bundle to push to other projects.</div>
          <div className="sk-input" style={{ marginBottom: 8, fontSize: 12, fontFamily: 'var(--read)' }}>my-may-2026-update</div>
          <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--ink-faint)', marginBottom: 6 }}>Push to:</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 14, borderRadius: 3, border: '1.5px solid var(--line)', background: 'var(--ink)', color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>✓</span>~/code/sketches</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 14, borderRadius: 3, border: '1.5px solid var(--line)', background: 'var(--ink)', color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>✓</span>~/work/dashboard</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink-soft)' }}><span style={{ width: 14, height: 14, borderRadius: 3, border: '1.5px solid var(--line-soft)' }}/>~/sketch/proto-7</label>
          </div>
        </div>

        <div style={{ flex: 1 }}/>
        <div style={{ display: 'flex', gap: 6 }}>
          <span className="sk-btn ghost">Skip</span>
          <div style={{ flex: 1 }}/>
          <span className="sk-btn">Save bundle only</span>
          <span className="sk-btn primary">Save + push to 2 →</span>
        </div>
      </div>
      <div className="anno" style={{ top: 320, right: -160, width: 150 }}>
        re-deploy extension —<br/>turn fresh updates into<br/>a new bundle, push<br/>to extra projects
      </div>
    </div>
  );
}

// ───── Deploy view: manage projects (add/remove) + remove flow ─────
function DeployFlow() {
  const Project = ({ path, count, last }) => (
    <div className="sk-box" style={{ padding: 10, marginBottom: 8, background: 'var(--paper)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14 }}>📁</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{path}</div>
          <div style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{count} skills · {last}</div>
        </div>
        <span className="sk-btn sm ghost">Open</span>
        <span className="sk-btn sm ghost" style={{ color: 'var(--warn)' }}>Remove…</span>
      </div>
    </div>
  );
  return (
    <div className="wf-window wf" style={{ width: 600, height: 580 }}>
      <TitleBar title="Deploy"/>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, flex: 1, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Tracked projects</div>
            <div className="hand" style={{ color: 'var(--ink-soft)', fontSize: 15 }}>add or remove projects, manage their <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>.claude/skills/</span></div>
          </div>
          {window.ViewSwitcher && <window.ViewSwitcher active="deploy"/>}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div className="sk-input" style={{ flex: 1, fontFamily: 'var(--read)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>+</span>
            <span style={{ color: 'var(--ink-faint)' }}>~/code/new-project</span>
          </div>
          <span className="sk-btn">Browse…</span>
          <span className="sk-btn primary">Add project</span>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--ink-faint)', textTransform: 'uppercase', margin: '4px 0' }}>Tracked · 4</div>
          <Project path="~/code/myapp" count="3" last="deployed today"/>
          <Project path="~/code/landing" count="2" last="updated 3d ago"/>
          <Project path="~/work/agents" count="5" last="updated today"/>
          <Project path="~/sketch/proto-7" count="1" last="2w ago"/>
        </div>
      </div>
    </div>
  );
}

// ───── Remove project confirmation: leave or clean ─────
function DeployRemoveConfirm() {
  return (
    <div className="wf-window wf" style={{ width: 580, height: 580 }}>
      <TitleBar title="Remove project — confirm"/>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12, flex: 1, overflow: 'auto' }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Remove <span style={{ fontFamily: 'var(--mono)', fontSize: 14 }}>~/code/myapp</span> from tracking?</div>
        <div className="hand" style={{ color: 'var(--ink-soft)', fontSize: 15 }}>
          stops cascading updates. doesn't touch the project itself unless you ask.
        </div>
        <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--ink-faint)', textTransform: 'uppercase' }}>What about installed skills?</div>
        <div className="sk-box" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'default' }}>
            <span style={{ width: 14, height: 14, borderRadius: '50%', border: '1.5px solid var(--line)', background: 'var(--paper)', marginTop: 2, flexShrink: 0 }}/>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Leave skills installed</div>
              <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>files in <span style={{ fontFamily: 'var(--mono)' }}>.claude/skills/</span> stay put — useful if you migrated the project</div>
            </div>
          </label>
          <div className="sk-divider soft"/>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'default', background: '#fff3a0', margin: -8, padding: 8, borderRadius: 6 }}>
            <span style={{ width: 14, height: 14, borderRadius: '50%', border: '1.5px solid var(--line)', background: 'var(--ink)', marginTop: 2, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'white' }}/>
            </span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Remove deployed skills <span style={{ color: 'var(--warn)' }}>and clean directory</span></div>
              <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>delete the listed folders below from disk</div>
            </div>
          </label>
        </div>
        <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--ink-faint)', textTransform: 'uppercase' }}>Will delete · 3 folders</div>
        <div className="sk-box" style={{ padding: 0, fontFamily: 'var(--mono)', fontSize: 11 }}>
          {[
            ['~/code/myapp/.claude/skills/frontend-design', '8 files · 24 KB'],
            ['~/code/myapp/.claude/skills/make-deck', '12 files · 41 KB'],
            ['~/code/myapp/.claude/skills/pdf-tools', '6 files · 18 KB'],
          ].map(([p, s], i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: i < 2 ? '1px dashed var(--line-soft)' : 'none', gap: 8 }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, border: '1.5px solid var(--line)', background: 'var(--ink)', color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>✓</span>
              <span style={{ flex: 1 }}>{p}</span>
              <span style={{ color: 'var(--ink-faint)', fontFamily: 'var(--read)' }}>{s}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--warn)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>⚠</span> tick each to confirm — these are permanent deletes
        </div>
        <div style={{ flex: 1 }}/>
        <div style={{ display: 'flex', gap: 6 }}>
          <span className="sk-btn ghost">Cancel</span>
          <div style={{ flex: 1 }}/>
          <span className="sk-btn">Untrack only</span>
          <span className="sk-btn" style={{ background: 'var(--warn)', color: 'white', borderColor: 'var(--warn)' }}>Untrack + delete 3 →</span>
        </div>
      </div>
    </div>
  );
}

// ───── Settings (kept) ─────
function SettingsView() {
  const Row = ({ label, value, hint, control = 'value' }) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', padding: '12px 0', borderBottom: '1px dashed var(--line-soft)', gap: 14 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{hint}</div>}
      </div>
      {control === 'toggle' ? (
        <div style={{ width: 32, height: 18, borderRadius: 9, border: '1.5px solid var(--line)', background: value ? 'var(--ink)' : 'var(--paper)', position: 'relative', flexShrink: 0 }}>
          <div style={{ position: 'absolute', top: 1, left: value ? 15 : 1, width: 12, height: 12, borderRadius: '50%', background: value ? 'white' : 'var(--ink-soft)' }}/>
        </div>
      ) : (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-soft)' }}>{value}</div>
      )}
    </div>
  );
  return (
    <div className="wf-window wf" style={{ width: 600, height: 600 }}>
      <TitleBar title="Settings"/>
      <div style={{ padding: 22, display: 'flex', flexDirection: 'column', flex: 1, overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Settings</div>
          {window.ViewSwitcher && <window.ViewSwitcher active="settings"/>}
        </div>
        <div className="hand" style={{ color: 'var(--ink-faint)', fontSize: 14, marginBottom: 6 }}>local install — no accounts, no sync</div>
        <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--ink-faint)', textTransform: 'uppercase', marginTop: 10 }}>Paths</div>
        <Row label="Library folder" value="~/.claude/skills" hint="where skills live on disk"/>
        <Row label="Config" value="~/.claude/skill-manager.json" hint="tracked sources, deployments"/>
        <Row label="Project root default" value="~/code"/>
        <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--ink-faint)', textTransform: 'uppercase', marginTop: 16 }}>Behavior</div>
        <Row label="Auto-check updates on launch" value={true} control="toggle" hint="git ls-remote, parallel"/>
        <Row label="Cascade updates to projects" value={true} control="toggle" hint="re-copy on update"/>
        <Row label="Confirm before remove" value={true} control="toggle"/>
        <Row label="Show resource-only entries" value={false} control="toggle" hint="folders without SKILL.md"/>
        <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--ink-faint)', textTransform: 'uppercase', marginTop: 16 }}>About</div>
        <Row label="Version" value="0.4.1"/>
        <Row label="Git binary" value="/opt/homebrew/bin/git" hint="from PATH"/>
        <div style={{ flex: 1, minHeight: 8 }}/>
        <div style={{ display: 'flex', gap: 6, paddingTop: 12 }}>
          <span className="sk-btn ghost">Open library folder</span>
          <span className="sk-btn ghost">Edit config.json</span>
          <div style={{ flex: 1 }}/>
          <span className="sk-btn ghost" style={{ color: 'var(--warn)' }}>Reset config</span>
        </div>
      </div>
    </div>
  );
}

window.InstallFlow = InstallFlow;
window.SkillDetail = SkillDetail;
window.UpdateReview = UpdateReview;
window.UpdateProgress = UpdateProgress;
window.UpdateDone = UpdateDone;
window.DeployFlow = DeployFlow;
window.DeployRemoveConfirm = DeployRemoveConfirm;
window.SettingsView = SettingsView;

// Library variations — C is default, B and D are alternatives
// switched via Tweaks panel

const LibSkillRow = ({ name, desc, badge, selected, mono }) => (
  <div className={`skill-row ${selected ? 'selected' : ''}`}>
    <div className="skill-icon">{name.slice(0,1).toUpperCase()}</div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="skill-name">{name}</div>
      {desc && <div className="skill-desc" style={{ fontFamily: mono ? 'var(--mono)' : undefined, fontSize: mono ? 10 : 11 }}>{desc}</div>}
    </div>
    {badge && <span className={`sk-tag ${badge.kind || ''}`}>{badge.label}</span>}
  </div>
);

// Update banner that pops on launch — used by all library variants
const UpdateBanner = ({ count = 3 }) => (
  <div className="sk-box shadow tilt-l" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, background: '#fff3a0', borderColor: 'var(--accent)', borderWidth: 2 }}>
    <div style={{ fontSize: 18 }}>⚡</div>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}><span className="hl">{count} updates</span> available</div>
      <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>cascades to 6 project deployments</div>
    </div>
    <span className="sk-btn accent">Review updates →</span>
  </div>
);

// Variation C — Card grid (DEFAULT)
function LibraryC() {
  const Card = ({ name, desc, badge, accent, selected }) => (
    <div className={`sk-box ${selected ? 'shadow' : ''}`} style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, position: 'relative', background: selected ? '#fff8d8' : 'var(--paper)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div className="skill-icon" style={{ width: 36, height: 36, fontSize: 14, background: accent || 'var(--paper-2)' }}>{name.slice(0,1).toUpperCase()}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="skill-name" style={{ fontSize: 13 }}>{name}</div>
          <div className="skill-desc">{desc}</div>
        </div>
      </div>
      <div className="sk-line med"/>
      <div className="sk-line short"/>
      <div style={{ display: 'flex', gap: 4, marginTop: 'auto', alignItems: 'center' }}>
        {badge && <span className={`sk-tag ${badge.kind || ''}`}>{badge.label}</span>}
        <div style={{ flex: 1 }}/>
        <span className="sk-btn sm">Deploy</span>
      </div>
    </div>
  );
  return (
    <div className="wf-window wf" style={{ width: 820, height: 640 }}>
      <div className="wf-titlebar">
        <div className="wf-tlights"><div className="tl"/><div className="tl"/><div className="tl"/></div>
        <div className="wf-title">Skill Library</div>
        <div style={{ width: 30 }}/>
      </div>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ width: 170, borderRight: '1.5px solid var(--line-soft)', padding: 12, display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--paper-2)' }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--ink-faint)', textTransform: 'uppercase' }}>Library</div>
          <div style={{ padding: '5px 8px', borderRadius: 5, background: 'var(--ink)', color: 'white', fontSize: 12 }}>All · 14</div>
          <div style={{ padding: '5px 8px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            Updates · 3 <span className="sk-tag update" style={{ fontSize: 9, padding: '0 5px' }}>NEW</span>
          </div>
          <div style={{ padding: '5px 8px', fontSize: 12 }}>Bundles · 2</div>
          <div style={{ padding: '5px 8px', fontSize: 12 }}>Local · 3</div>
          <div style={{ padding: '5px 8px', fontSize: 12 }}>Deployed · 11</div>
          <div className="sk-divider soft"/>
          <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--ink-faint)', textTransform: 'uppercase' }}>Projects</div>
          <div style={{ padding: '4px 8px', fontSize: 11, fontFamily: 'var(--mono)' }}>~/code/myapp</div>
          <div style={{ padding: '4px 8px', fontSize: 11, fontFamily: 'var(--mono)' }}>~/code/landing</div>
          <div style={{ padding: '4px 8px', fontSize: 11, fontFamily: 'var(--mono)' }}>~/work/agents</div>
          <div style={{ flex: 1 }}/>
          <span className="sk-btn sm ghost" style={{ justifyContent: 'center' }}>⚙ Settings</span>
        </div>
        <div style={{ flex: 1, padding: 14, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            {window.ViewSwitcher && <window.ViewSwitcher active="library"/>}
          </div>
          <UpdateBanner count={3}/>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div className="sk-input" style={{ flex: 1, fontFamily: 'var(--read)', fontSize: 12 }}>+ Paste GitHub URL or skill name…</div>
            <span className="sk-btn primary">Install</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <Card name="pdf-tools" desc="parse + render PDFs" />
            <Card name="make-deck" desc="slide decks in HTML" badge={{ kind: 'update', label: 'UPDATE' }} accent="#fef4a8" />
            <Card name="frontend-design" desc="aesthetic direction" selected/>
            <Card name="anthropic-skills" desc="bundle · 12 skills" badge={{ label: 'bundle' }} />
            <Card name="napkin-reader" desc="parse .napkin files" />
            <Card name="wireframe" desc="explore design space" badge={{ kind: 'update', label: 'UPDATE' }} accent="#fef4a8" />
            <Card name="pptx-export" desc="native PowerPoint" badge={{ label: 'local' }} />
            <Card name="canvas-export" desc="send to Canva" badge={{ kind: 'update', label: 'UPDATE' }} accent="#fef4a8" />
            <Card name="claude-handoff" desc="dev package" />
          </div>
        </div>
      </div>
      <div className="anno" style={{ top: 90, right: -150, width: 140 }}>
        update banner pops<br/>on launch — primary<br/>colored CTA
        <svg width="40" height="20" style={{ position: 'absolute', left: -45, top: -6 }}>
          <path d="M40 5 Q 20 -5 5 8" stroke="var(--accent)" strokeWidth="1.5" fill="none"/>
          <path d="M5 8 L 14 4 M 5 8 L 12 13" stroke="var(--accent)" strokeWidth="1.5" fill="none"/>
        </svg>
      </div>
    </div>
  );
}

// Variation B — two pane (alternate)
function LibraryB() {
  return (
    <div className="wf-window wf" style={{ width: 820, height: 580 }}>
      <div className="wf-titlebar">
        <div className="wf-tlights"><div className="tl"/><div className="tl"/><div className="tl"/></div>
        <div className="wf-title">Skill Manager — Library</div>
        <div style={{ width: 30 }}/>
      </div>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ width: 320, borderRight: '1.5px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: 10, borderBottom: '1.5px solid var(--line-soft)', display: 'flex', gap: 6, flexDirection: 'column' }}>
            <div className="sk-input" style={{ fontFamily: 'var(--read)', fontSize: 12 }}>🔍 search 14 skills</div>
          </div>
          <div style={{ padding: 8 }}>
            <UpdateBanner count={3}/>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <div style={{ padding: '6px 10px', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: 1 }}>All · 14</div>
            <LibSkillRow name="make-deck" desc="3d ago · @anthropic" badge={{ kind: 'update', label: 'UPDATE' }} />
            <LibSkillRow name="pdf-tools" desc="2w ago · 4 deploys" />
            <LibSkillRow name="anthropic-skills" desc="bundle · 12 inside" />
            <LibSkillRow name="frontend-design" desc="updated today" selected />
            <LibSkillRow name="napkin-reader" desc="1mo" />
            <LibSkillRow name="pptx-export" desc="local · never deployed" badge={{ label: 'local' }} />
            <LibSkillRow name="wireframe" desc="updated today" badge={{ kind: 'update', label: 'UPDATE' }} />
          </div>
        </div>
        <div style={{ flex: 1, padding: 18, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>frontend-design</div>
            <div style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--ink-faint)' }}>github.com/anthropic/skills/frontend-design @ 8a2c1f3</div>
          </div>
          <div className="sk-box" style={{ padding: 10, background: 'var(--paper-2)' }}>
            <div className="sk-line med"/><div style={{ height: 4 }}/>
            <div className="sk-line"/><div style={{ height: 4 }}/>
            <div className="sk-line short"/>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span className="sk-tag">SKILL.md</span>
            <span className="sk-tag">references/</span>
            <span className="sk-tag">scripts/</span>
            <span className="sk-tag good">up to date</span>
          </div>
          <div className="sk-divider soft"/>
          <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--ink-faint)', textTransform: 'uppercase' }}>Deployed (3)</div>
          {['~/code/myapp', '~/code/landing', '~/work/agents'].map(p => (
            <div key={p} style={{ fontSize: 12, fontFamily: 'var(--mono)' }}>{p}</div>
          ))}
          <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
            <span className="sk-btn primary">Deploy</span>
            <span className="sk-btn">Update</span>
            <span className="sk-btn ghost">Browse</span>
            <div style={{ flex: 1 }}/>
            <span className="sk-btn ghost" style={{ color: 'var(--warn)' }}>Remove</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Variation D — command palette (alternate, power user)
function LibraryD() {
  return (
    <div className="wf-window wf" style={{ width: 660, height: 540 }}>
      <div className="wf-titlebar">
        <div className="wf-tlights"><div className="tl"/><div className="tl"/><div className="tl"/></div>
        <div className="wf-title">⌘K Skill Manager</div>
        <div style={{ width: 30 }}/>
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        <UpdateBanner count={3}/>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: '1.5px solid var(--line)', borderRadius: 6, background: 'var(--paper-2)' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--accent)' }}>›</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 13, flex: 1 }}>install <span style={{ color: 'var(--ink-faint)' }}>github.com/anthropic/skills</span><span className="hand" style={{ marginLeft: 4, color: 'var(--accent)' }}>|</span></div>
          <span className="sk-tag mono">⏎ run</span>
        </div>
        <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--ink-faint)', textTransform: 'uppercase', padding: '4px 4px 0' }}>Suggestions</div>
        <div className="sk-box" style={{ padding: 0, overflow: 'hidden' }}>
          {[
            ['install <url>', 'clone a repo into library'],
            ['deploy <skill> → <project>', 'copy to .claude/skills/'],
            ['update --all', 'check + cascade'],
            ['list --updates', 'show stale skills'],
            ['rm pptx-export', 'remove from library'],
          ].map(([cmd, desc], i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '6px 12px', borderBottom: i < 4 ? '1px dashed var(--line-soft)' : 'none', background: i === 0 ? '#fff8d8' : 'transparent' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 12, flex: 1 }}>{cmd}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{desc}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--ink-faint)', textTransform: 'uppercase', padding: '4px 4px 0' }}>Library · 14</div>
        <div style={{ flex: 1, overflow: 'auto', fontFamily: 'var(--mono)', fontSize: 11, lineHeight: 1.7, color: 'var(--ink-soft)' }}>
          <div>pdf-tools           <span style={{ color: 'var(--ink-faint)' }}>2w</span>  4 deploys</div>
          <div>make-deck           <span style={{ color: 'var(--accent)' }}>UPDATE</span>  3 deploys</div>
          <div>frontend-design     <span style={{ color: 'var(--ink-faint)' }}>today</span> 3 deploys</div>
          <div>anthropic-skills    <span style={{ color: 'var(--ink-faint)' }}>bundle</span> 12 inside</div>
          <div>napkin-reader       <span style={{ color: 'var(--ink-faint)' }}>1mo</span>  1 deploy</div>
          <div>pptx-export         <span style={{ color: 'var(--ink-faint)' }}>local</span> —</div>
          <div>wireframe           <span style={{ color: 'var(--accent)' }}>UPDATE</span> 2 deploys</div>
        </div>
        <div style={{ display: 'flex', gap: 8, fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--ink-faint)', borderTop: '1px solid var(--line-soft)', paddingTop: 6 }}>
          <span>↑↓ navigate</span><span>⏎ run</span><span>tab autocomplete</span><span>esc close</span>
        </div>
      </div>
    </div>
  );
}

window.LibraryB = LibraryB;
window.LibraryC = LibraryC;
window.LibraryD = LibraryD;
window.UpdateBanner = UpdateBanner;

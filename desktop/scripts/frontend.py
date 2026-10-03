"""Keep the complete HTML in Tauri's asset pipeline; fetch personal records separately."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BOOT = '''loadEdits();loadPref();initData(RAW_DATA);updateDataDate();
initWorkspaceUI();
initServerStorage().then(()=>ensureViewData(view));'''
DESKTOP_BOOT = '''window.__TOUDI_DESKTOP_READY__.then(()=>{
RAW_DATA.push(...window.__TOUDI_INITIAL_RECORDS__);
''' + BOOT + '''
}).catch(window.toudiDesktopStartupError);'''


def prepare_frontend(root=ROOT):
    root = Path(root)
    source = (root/'app/投递管理.html').read_text(encoding='utf-8')
    if source.count(BOOT) != 1 or source.count('<head>') != 1:
        raise ValueError('Desktop bootstrap no longer matches the HTML; update the explicit boot adapter.')
    if 'const RAW_DATA = [];' not in source:
        raise ValueError('Desktop builds require the clean public template.')
    html = source.replace('<head>', '<head>\n<script src="/desktop-bridge.js"></script>\n<script src="/desktop-entry.js"></script>\n<style>.desktop-startup-error{position:fixed;inset:32px;z-index:10000;background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:32px;display:flex;flex-direction:column;align-items:flex-start;gap:20px}</style>', 1)
    html = html.replace(BOOT, DESKTOP_BOOT, 1)
    output = root/'desktop/ui/workbench.html'
    output.write_text(html, encoding='utf-8')
    return output


if __name__ == '__main__':
    print(prepare_frontend())

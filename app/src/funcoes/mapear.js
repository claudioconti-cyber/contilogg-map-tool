// mapear.js
const fs = require('fs');
const { chromium } = require('playwright');

/* ========================   ESTADO INTERNO   ======================== */
let browser = null;
let context = null;
let page = null;
let output = '';
let interactions = [];
let ajaxCount = 0;
let mapMode = null; // "consultar" | "inserir" | null

/* =================================================================== */

/**
 * Inicia o navegador, injeta o código que captura interações
 * e navega até a URL alvo.
 *
 * @param {string} url          URL a ser mapeada
 * @param {string} outputFile   Caminho do arquivo .json de saída
 */
async function start(url, outputFile = 'mapa.json', modo = null) {
    if (browser) throw new Error('Mapeamento já em execução');

    output = outputFile;
    interactions = [];
    ajaxCount = 0;
    mapMode = modo || null;

    /* === FLAGS herdadas do mapear_old.js === */
    const SAVE_ONLY_UNIQUE_VISIBLE = true;
    const LOG_WARN_NON_UNIQUE = true;
    const LOG_SKIP_REASON = true;

    /* === Cria navegador Playwright === */
    browser = await chromium.launch({ headless: false, slowMo: 300 });
    context = await browser.newContext();
    page = await context.newPage();

    /* === Contador de XHR/fetch === */
    context.on('request', req => {
        const t = req.resourceType();
        if (t === 'xhr' || t === 'fetch') ajaxCount++;
    });

    /* === INJETAR SCRIPT DE CAPTURA (mesmo conteúdo do mapear_old.js) === */
    await context.addInitScript(
        (SAVE_ONLY_UNIQUE_VISIBLE, LOG_WARN_NON_UNIQUE, LOG_SKIP_REASON) => {

            // Polyfill CSS.escape
            if (!('CSS' in window)) window.CSS = {};
            if (typeof window.CSS.escape !== 'function') {
                window.CSS.escape = function (value) {
                    return String(value).replace(/[^a-zA-Z0-9_\u00A0-\uFFFF-]/g, ch => {
                        const hex = ch.charCodeAt(0).toString(16).toUpperCase();
                        return '\\' + hex + ' ';
                    });
                };
            }

            /* ---------- Utilidades para seletor, visibilidade, etc. ---------- */
            function cssQuote(v) { return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
            function idSelector(id) { try { return '#' + CSS.escape(id); } catch { return `[id="${cssQuote(id)}"]`; } }
            function isVisible(el) {
                if (!el || el.nodeType !== 1) return false;
                const rect = el.getClientRects(); if (!rect || rect.length === 0) return false;
                const cs = window.getComputedStyle(el);
                if (!cs || cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') === 0) return false;
                const r = rect[0]; return (r.width || 0) > 0 && (r.height || 0) > 0;
            }
            function hasPositiveTab(el) {
                const t = el.getAttribute && el.getAttribute('tabindex'); if (t == null) return false;
                const n = parseInt(t, 10); return !Number.isNaN(n) && n >= 0;
            }
            function hasRole(el, roles) {
                const role = el.getAttribute && el.getAttribute('role');
                return role && roles.includes(role.toLowerCase());
            }

            const CLICKABLE_CSS = `
        button, [role="button"], a[href], input[type="button"], input[type="submit"],
        [role="menuitem"], [role="option"], .rf-ddm-itm, .rf-ddm-itm a,
        [aria-haspopup], [aria-expanded], [onclick], [tabindex]:not([tabindex="-1"])
      `;

            function isClickableCandidate(el) {
                if (!el || el.nodeType !== 1) return false;
                try { if (el.matches(CLICKABLE_CSS)) return true; } catch { }
                if (el.hasAttribute && el.hasAttribute('onclick')) return true;
                if (hasPositiveTab(el)) return true;
                if (hasRole(el, ['button', 'menuitem', 'option', 'link'])) return true;
                if (el.tagName === 'A' && (el.getAttribute('href') || el.getAttribute('onclick'))) return true;
                if (el.tagName === 'INPUT') {
                    const t = (el.getAttribute('type') || '').toLowerCase();
                    if (t === 'button' || t === 'submit') return true;
                }
                return false;
            }

            function getClickable(el) {
                if (!el || el.nodeType !== 1) return el;
                const via = el.closest(CLICKABLE_CSS); let cand = via || el;
                while (cand && !isClickableCandidate(cand)) cand = cand.parentElement;
                return cand || el;
            }

            function shortSelector(el) {
                if (el.dataset && el.dataset.testid) return `[data-testid="${cssQuote(el.dataset.testid)}"]`;
                const name = el.getAttribute && el.getAttribute('name');
                if (name) return `[name="${cssQuote(name)}"]`;
                if (el.id) return idSelector(el.id);
                if (typeof el.getAttributeNames === 'function') {
                    for (const a of el.getAttributeNames()) {
                        if (a.startsWith('data-') || a.startsWith('aria-')) {
                            const v = el.getAttribute(a); if (v) return `[${a}="${cssQuote(v)}"]`;
                        }
                    }
                }
                if (el.classList && el.classList.length) {
                    const cls = [...el.classList].join('.');
                    const idx = el.parentElement ? [...el.parentElement.children].indexOf(el) + 1 : 1;
                    return `${el.tagName.toLowerCase()}.${cls}:nth-child(${idx})`;
                }
                const idx = el.parentElement ? [...el.parentElement.children].indexOf(el) + 1 : 1;
                return `${el.tagName.toLowerCase()}:nth-child(${idx})`;
            }

            function isUnique(sel) { try { return document.querySelectorAll(sel).length === 1; } catch { return false; } }
            function uniqueSelector(el) {
                let sel = shortSelector(el); if (isUnique(sel)) return sel;
                let cur = el;
                while (cur && cur.parentElement) {
                    const parentSel = shortSelector(cur.parentElement);
                    const chained = `${parentSel} > ${sel}`;
                    if (isUnique(chained)) return chained;
                    sel = chained; cur = cur.parentElement;
                }
                return sel;
            }

            function buildSelectorForClick(target) {
                let clickable = getClickable(target);
                if (!isVisible(clickable)) {
                    let p = clickable, rebased = null;
                    while (p && p.parentElement) {
                        p = p.parentElement;
                        if (isClickableCandidate(p) && isVisible(p)) { rebased = p; break; }
                    }
                    if (rebased) clickable = rebased;
                    else if (SAVE_ONLY_UNIQUE_VISIBLE) return { selector: null, reason: 'no-visible-clickable-ancestor' };
                }
                const sel = uniqueSelector(clickable);
                const unique = isUnique(sel); const visible = isVisible(clickable);
                if (SAVE_ONLY_UNIQUE_VISIBLE && (!unique || !visible))
                    return { selector: null, reason: unique ? 'not-visible' : 'not-unique' };
                return { selector: sel, unique, visible };
            }

            function buildSelectorForField(target) {
                const sel = uniqueSelector(target);
                const unique = isUnique(sel); const visible = isVisible(target);
                if (SAVE_ONLY_UNIQUE_VISIBLE && (!unique || !visible))
                    return { selector: null, reason: unique ? 'not-visible' : 'not-unique' };
                return { selector: sel, unique, visible };
            }

            function pushInteractionRaw(el, action) {
                if (!el || el.nodeType !== 1) return;
                const tag = (el.tagName || '').toLowerCase();
                const built = action === 'click' ? buildSelectorForClick(el) : buildSelectorForField(el);
                if (!built.selector) {
                    if (LOG_SKIP_REASON) console.warn(`⏭ ignorado (${action}):`, built.reason || 'no-selector');
                    return;
                }
                if (LOG_WARN_NON_UNIQUE && built.unique === false) {
                    try {
                        const c = document.querySelectorAll(built.selector).length;
                        if (c !== 1) console.warn('⚠ seletor não único:', built.selector, '(count=', c, ')');
                    } catch (e) { console.warn('⚠ seletor inválido:', built.selector, e); }
                }
                window.reportInteraction({
                    selector: built.selector,
                    action,
                    tagName: tag,
                    visible: built.visible === true,
                    unique: built.unique === true,
                    attrs: {
                        name: el.getAttribute && el.getAttribute('name'),
                        type: el.getAttribute && el.getAttribute('type'),
                        placeholder: el.getAttribute && el.getAttribute('placeholder'),
                        id: el.getAttribute && el.getAttribute('id'),
                        role: el.getAttribute && el.getAttribute('role'),
                        text: (el.textContent || '').trim().slice(0, 120)
                    },
                    timestamp: Date.now(),
                    url: window.location.href
                });
            }

            /* --------- debounce input / listeners (iguais ao mapear_old.js) --------- */
            const inputTimers = new Map(); const DEBOUNCE = 1000;
            function debounced(el) {
                const sel = buildSelectorForField(el).selector; if (!sel) return;
                if (inputTimers.has(sel)) clearTimeout(inputTimers.get(sel));
                const t = setTimeout(() => { pushInteractionRaw(el, 'input'); inputTimers.delete(sel); }, DEBOUNCE);
                inputTimers.set(sel, t);
            }
            function flushInput(el) {
                const sel = buildSelectorForField(el).selector; if (!sel) return;
                const t = inputTimers.get(sel); if (t) { clearTimeout(t); inputTimers.delete(sel); pushInteractionRaw(el, 'input'); }
            }

            document.addEventListener('click', e => pushInteractionRaw(e.target, 'click'), true);
            document.addEventListener('change', e => {
                const el = e.target, tag = (el.tagName || '').toLowerCase();
                if (tag === 'input' || tag === 'textarea' || tag === 'select') {
                    flushInput(el); pushInteractionRaw(el, 'change');
                }
            }, true);
            document.addEventListener('input', e => {
                const el = e.target, tag = (el.tagName || '').toLowerCase();
                if (tag === 'input' || tag === 'textarea') debounced(el);
            }, true);
            document.addEventListener('blur', e => {
                const el = e.target, tag = (el.tagName || '').toLowerCase();
                if (tag === 'input' || tag === 'textarea') flushInput(el);
            }, true);
            document.addEventListener('keydown', e => {
                if (e.key !== 'Enter') return;
                const el = document.activeElement || document.body;
                const built = buildSelectorForField(el);
                if (!built.selector) {
                    if (LOG_SKIP_REASON) console.warn('⏭ ignorado (press Enter):', built.reason || 'no-selector');
                    return;
                }
                window.reportInteraction({
                    selector: built.selector,
                    action: 'press',
                    tagName: (el.tagName || '').toLowerCase(),
                    visible: built.visible === true,
                    unique: built.unique === true,
                    attrs: {
                        name: el.getAttribute && el.getAttribute('name'),
                        type: el.getAttribute && el.getAttribute('type'),
                        placeholder: el.getAttribute && el.getAttribute('placeholder'),
                        id: el.getAttribute && el.getAttribute('id'),
                        role: el.getAttribute && el.getAttribute('role'),
                        text: (el.textContent || '').trim().slice(0, 120)
                    },
                    meta: { key: 'Enter' },
                    timestamp: Date.now(),
                    url: window.location.href
                });
            }, true);
        },
        SAVE_ONLY_UNIQUE_VISIBLE, LOG_WARN_NON_UNIQUE, LOG_SKIP_REASON
    );
    /* ----------- FIM DO SCRIPT INJETADO ----------- */

    /* Expondo função que o script injetado usa */
    await page.exposeFunction('reportInteraction', meta => {
        meta.network = ajaxCount > 0;
        ajaxCount = 0;
        interactions.push(meta);
        console.log('✔', meta.action, meta.selector || '(ignorado)');
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log(`✅ Pronto para gravar em: ${url}`);
    console.log(`🛑 Clique em "Parar" na UI para finalizar gravação em "${output}"`);
}

/**
 * Finaliza o mapeamento, monta o JSON e grava em disco.
 */
async function stop() {
    if (!browser) throw new Error('Nenhum mapeamento em andamento');

    /* ----- Inferir login + steps (mesmo algoritmo do mapear_old.js) ----- */
    const login = {};
    for (const it of interactions) {
        const type = it.attrs?.type || '';
        const tag = it.tagName || '';
        if (type === 'password' && !login.password) { login.password = it.selector; continue; }
        if ((type === 'text' || type === 'email' || type === 'tel') && !login.username) {
            login.username = it.selector; continue;
        }
        if (it.action === 'click' && (tag === 'button' || type === 'submit') &&
            login.username && login.password && !login.submit) {
            login.submit = it.selector; continue;
        }
    }

    const loginSel = new Set([login.username, login.password, login.submit].filter(Boolean));
    const seen = new Set(); const steps = [];
    for (const it of interactions) {
        if (!it.selector || loginSel.has(it.selector)) continue;
        const tag = it.tagName || ''; const attrs = it.attrs || {};
        let act = null;
        if (it.action === 'click') act = 'click';
        else if ((tag === 'input' || tag === 'textarea') && (it.action === 'input' || it.action === 'change'))
            act = attrs.type === 'file' ? 'upload' : 'fill';
        else if (tag === 'select' && it.action === 'change') act = 'select';
        else if (it.action === 'press' && it.meta?.key?.toLowerCase() === 'enter') act = 'press';
        if (!act) continue;

        const keyAttr = (attrs.name || attrs.placeholder || attrs.id || '').toLowerCase().replace(/\s+/g, '');
        const k = `${act}::${it.selector}`; if (seen.has(k)) continue; seen.add(k);

        steps.push({
            action: act,
            selector: it.selector,
            ...(act === 'fill' || act === 'upload' ? { key: keyAttr } : {}),
            meta: {
                role: attrs.role || null,
                text: attrs.text || null,
                networkTriggered: it.network === true,
                ...(act === 'press' ? { key: 'Enter' } : {})
            }
        });
    }

    // Descobrir o selector de logout: assume-se que o último clique é o "Sair"
    let logoutSelector = steps.pop().selector;

    // Se for mapa de consulta, marque o último step como âncora de verificação de resultado
    if (mapMode === 'consultar' && steps.length > 0) {
        const last = steps[steps.length - 1];
        last.meta = { ...(last.meta || {}), resultSelector: true };
    }

    const finalMap = {
        modo: mapMode || null,
        login: (login.username && login.password && login.submit) ? login : {},
        steps,
        logout: logoutSelector || null
    };

    fs.writeFileSync(output, JSON.stringify(finalMap, null, 2));
    console.log(`✅ ${steps.length} passos salvos em ${output}`);

    await browser.close();
    browser = context = page = null;
    interactions = [];
    output = '';
    mapMode = null;
}

/* =========================  EXPORTA DUAS FUNÇÕES  ========================= */
module.exports = { start, stop };

// threads.js -- Slack-style thread panel, thread stubs, right-click thread creation
// Threads are side-conversations anchored to a root message in a channel.
// Thread messages do NOT appear in the main channel timeline.

'use strict';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _threadsPanelOpen = false;
let _threadsListView = true; // true = list, false = detail
let _currentThreadId = null;
let _threadCache = {}; // root_id -> { messages, status, owner, channel, title }
let _threadIndex = []; // array of thread summaries for list view
let _threadsFilter = ''; // '', 'open', 'done', 'resolved'

// ---------------------------------------------------------------------------
// Panel toggle
// ---------------------------------------------------------------------------

function toggleThreadsPanel() {
    const panel = document.getElementById('threads-panel');
    if (!panel) return;
    _threadsPanelOpen = !_threadsPanelOpen;
    panel.classList.toggle('hidden', !_threadsPanelOpen);
    document.getElementById('threads-toggle')?.classList.toggle('active', _threadsPanelOpen);
    if (_threadsPanelOpen) {
        _loadThreadList();
        _refreshThreadStubs();
    }
}

// ---------------------------------------------------------------------------
// Thread list
// ---------------------------------------------------------------------------

async function _loadThreadList() {
    const channel = window.activeChannel || 'general';
    try {
        const resp = await fetch(`/api/threads?channel=${encodeURIComponent(channel)}`, { headers: { 'X-Session-Token': window.SESSION_TOKEN } });
        if (!resp.ok) {
            // Try building from thread_store
            _threadIndex = [];
            _renderThreadList();
            return;
        }
        _threadIndex = await resp.json();
        if (_threadsFilter) {
            _threadIndex = _threadIndex.filter(t => t.status === _threadsFilter);
        }
        _renderThreadList();
    } catch (e) {
        _threadIndex = [];
        _renderThreadList();
    }
}

function _renderThreadList() {
    const container = document.getElementById('threads-list');
    if (!container) return;

    // Show list view, hide detail
    const listView = document.getElementById('threads-list-view');
    const detailView = document.getElementById('threads-detail-view');
    if (listView) listView.classList.remove('hidden');
    if (detailView) detailView.classList.add('hidden');
    _threadsListView = true;

    if (_threadIndex.length === 0) {
        container.innerHTML = `
            <div class="threads-empty">
                <div class="threads-empty-icon">&#x1F9F5;</div>
                <p>No threads yet</p>
                <div class="threads-empty-hint">Right-click a message to start a thread</div>
            </div>`;
        return;
    }

    container.innerHTML = '';
    for (const thread of _threadIndex) {
        const item = document.createElement('div');
        item.className = 'thread-list-item';
        item.dataset.threadId = thread.root_id;

        const status = thread.status || 'open';
        const rootMsg = thread.root_message || {};
        const title = thread.title || (rootMsg.text ? rootMsg.text.slice(0, 80) : `Thread #${thread.root_id}`);
        const replyCount = thread.reply_count || 0;
        const participants = thread.participants || [];

        item.innerHTML = `
            <div class="thread-item-header">
                <span class="thread-item-status ${status}">${status}</span>
                <span class="thread-item-meta">${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}</span>
            </div>
            <div class="thread-item-preview">
                <div class="thread-item-sender">${_escHtml(rootMsg.sender || thread.owner || '')}</div>
                <div class="thread-item-text">${_escHtml(title)}</div>
            </div>
            <div class="thread-item-footer">
                <span class="thread-item-channel">#${_escHtml(thread.channel || '')}</span>
                ${participants.length > 0 ? `<span>${participants.length} participant${participants.length > 1 ? 's' : ''}</span>` : ''}
            </div>`;

        item.onclick = () => _openThreadDetail(thread.root_id);
        container.appendChild(item);
    }
}

// ---------------------------------------------------------------------------
// Thread detail view
// ---------------------------------------------------------------------------

async function _openThreadDetail(rootId) {
    _currentThreadId = rootId;
    _threadsListView = false;

    const listView = document.getElementById('threads-list-view');
    const detailView = document.getElementById('threads-detail-view');
    if (listView) listView.classList.add('hidden');
    if (detailView) detailView.classList.remove('hidden');

    // Fetch thread messages
    try {
        const resp = await fetch(`/api/threads/${rootId}/messages`, { headers: { 'X-Session-Token': window.SESSION_TOKEN } });
        if (!resp.ok) throw new Error('Thread not found');
        const data = await resp.json();

        _threadCache[rootId] = data;
        _renderThreadDetail(data);
    } catch (e) {
        const msgContainer = document.getElementById('threads-detail-messages');
        if (msgContainer) {
            msgContainer.innerHTML = `<div class="threads-error">Failed to load thread. <button onclick="_openThreadDetail(${rootId})">Retry</button></div>`;
        }
    }
}

function _renderThreadDetail(data) {
    // Title
    const titleEl = document.getElementById('threads-detail-title');
    if (titleEl) {
        const rootMsg = data.messages?.[0];
        titleEl.textContent = data.title || (rootMsg ? rootMsg.text.slice(0, 60) : `Thread #${data.root_id}`);
    }

    // Status toggle
    const actionsEl = document.getElementById('threads-detail-actions');
    if (actionsEl) {
        const status = data.status || 'open';
        actionsEl.innerHTML = `<button class="thread-status-toggle ${status}" onclick="_cycleThreadStatus(${data.root_id}, '${status}')">${status}</button>`;
    }

    // Messages
    const msgContainer = document.getElementById('threads-detail-messages');
    if (!msgContainer) return;
    msgContainer.innerHTML = '';

    const messages = data.messages || [];
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const isRoot = i === 0;
        const el = document.createElement('div');
        el.className = 'thread-detail-message' + (isRoot ? ' thread-root-message' : '');

        const initial = (msg.sender || '?')[0].toUpperCase();
        el.innerHTML = `
            <div class="thread-msg-avatar">
                <span style="font-weight:600;font-size:14px;color:var(--text-muted)">${_escHtml(initial)}</span>
            </div>
            <div class="thread-msg-content">
                <div class="thread-msg-header">
                    <span class="thread-msg-sender">${_escHtml(msg.sender || '')}</span>
                    <span class="thread-msg-time">${_escHtml(msg.time || '')}</span>
                </div>
                <div class="thread-msg-text">${_renderThreadText(msg.text || '')}</div>
            </div>`;
        msgContainer.appendChild(el);
    }

    // Scroll to bottom
    msgContainer.scrollTop = msgContainer.scrollHeight;
}

function _renderThreadText(text) {
    // Basic markdown-ish rendering
    return _escHtml(text)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
}

async function _cycleThreadStatus(rootId, current) {
    const order = ['open', 'done', 'resolved'];
    const next = order[(order.indexOf(current) + 1) % order.length];
    try {
        await fetch(`/api/threads/${rootId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-Session-Token': window.SESSION_TOKEN },
            body: JSON.stringify({ status: next }),
        });
        if (_threadCache[rootId]) {
            _threadCache[rootId].status = next;
            _renderThreadDetail(_threadCache[rootId]);
        }
    } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Send thread reply
// ---------------------------------------------------------------------------

function sendThreadReply() {
    if (!_currentThreadId) return;
    const input = document.getElementById('threads-detail-input-text');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    const channel = _threadCache[_currentThreadId]?.channel || window.activeChannel || 'general';

    // Send as a message with reply_to pointing to thread root
    if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        window.ws.send(JSON.stringify({
            type: 'message',
            text: text,
            sender: window.username,
            channel: channel,
            reply_to: _currentThreadId,
            thread_id: _currentThreadId,
        }));
    }

    input.value = '';
    input.style.height = 'auto';
}

// ---------------------------------------------------------------------------
// Close thread detail (back to list)
// ---------------------------------------------------------------------------

function closeThreadDetail() {
    _currentThreadId = null;
    _threadsListView = true;
    const listView = document.getElementById('threads-list-view');
    const detailView = document.getElementById('threads-detail-view');
    if (listView) listView.classList.remove('hidden');
    if (detailView) detailView.classList.add('hidden');
    _loadThreadList();
}

// ---------------------------------------------------------------------------
// Thread filter
// ---------------------------------------------------------------------------

function showThreadsFilter() {
    const btn = document.querySelector('.threads-filter-btn');
    if (!btn) return;

    // Cycle through filters
    const filters = ['', 'open', 'done', 'resolved'];
    const idx = filters.indexOf(_threadsFilter);
    _threadsFilter = filters[(idx + 1) % filters.length];
    btn.classList.toggle('active', _threadsFilter !== '');
    btn.title = _threadsFilter ? `Filter: ${_threadsFilter}` : 'Filter';
    _loadThreadList();
}

// ---------------------------------------------------------------------------
// Thread stubs on root messages in channel timeline
// ---------------------------------------------------------------------------

function addThreadStubToMessage(msgEl, threadData) {
    if (!msgEl || msgEl.querySelector('.thread-meta-row')) return;

    const metaRow = document.createElement('div');
    metaRow.className = 'thread-meta-row';

    const replyCount = threadData.reply_count || threadData.message_count || 0;
    const status = threadData.status || 'open';

    const badge = document.createElement('span');
    badge.className = 'thread-reply-badge';
    badge.textContent = `${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`;
    badge.onclick = (e) => {
        e.stopPropagation();
        _ensurePanelOpen();
        _openThreadDetail(parseInt(msgEl.dataset.id));
    };
    metaRow.appendChild(badge);

    const statusBadge = document.createElement('span');
    statusBadge.className = `thread-status-badge ${status}`;
    statusBadge.textContent = status;
    metaRow.appendChild(statusBadge);

    // Insert after the message content
    const bubble = msgEl.querySelector('.chat-bubble') || msgEl;
    bubble.appendChild(metaRow);
}

function _ensurePanelOpen() {
    if (!_threadsPanelOpen) {
        toggleThreadsPanel();
    }
}

// ---------------------------------------------------------------------------
// Right-click "Start thread" context menu
// ---------------------------------------------------------------------------

function _setupMessageContextMenu() {
    const container = document.getElementById('messages');
    if (!container) return;

    container.addEventListener('contextmenu', (e) => {
        const msgEl = e.target.closest('.message');
        if (!msgEl) return;
        if (msgEl.classList.contains('join-msg') || msgEl.classList.contains('summary-msg')) return;

        const msgId = parseInt(msgEl.dataset.id);
        if (!msgId) return;

        e.preventDefault();
        _showThreadContextMenu(e, msgId, msgEl);
    });
}

function _showThreadContextMenu(e, msgId, msgEl) {
    // Remove any existing context menus
    document.querySelectorAll('.thread-context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'channel-context-menu thread-context-menu';
    menu.style.position = 'fixed';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    // Start thread option
    const threadBtn = document.createElement('button');
    threadBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h12M2 7h12M2 11h8"/></svg> Start thread';
    threadBtn.onclick = () => {
        menu.remove();
        _showThreadCreateDialog(msgId);
    };
    menu.appendChild(threadBtn);

    document.body.appendChild(menu);
    requestAnimationFrame(() => menu.classList.add('visible'));

    const close = (ev) => {
        if (!menu.contains(ev.target)) {
            menu.remove();
            document.removeEventListener('click', close);
        }
    };
    setTimeout(() => document.addEventListener('click', close), 0);
}

function _showThreadCreateDialog(rootMsgId) {
    const overlay = document.createElement('div');
    overlay.className = 'archive-modal-overlay';
    overlay.innerHTML = `
        <div class="archive-modal">
            <h3>Start a thread</h3>
            <p>This will create a side-conversation anchored to this message.</p>
            <input type="text" id="thread-title-input" placeholder="Thread title (optional)" style="
                width: 100%; padding: 8px 12px; background: var(--bg-secondary, #1a1a2e);
                border: 1px solid var(--border-color, rgba(255,255,255,0.15)); border-radius: 6px;
                color: var(--text-primary, #fff); font-size: 14px; margin-bottom: 16px; box-sizing: border-box;
            ">
            <div class="archive-modal-actions">
                <button class="btn-secondary" data-action="cancel">Cancel</button>
                <button class="btn-danger" data-action="create" style="background: var(--accent, #4a9eff);">Create thread</button>
            </div>
        </div>`;

    overlay.querySelector('[data-action="cancel"]').onclick = () => overlay.remove();
    overlay.querySelector('[data-action="create"]').onclick = () => {
        const titleInput = document.getElementById('thread-title-input');
        const title = titleInput?.value.trim() || `Thread on message #${rootMsgId}`;
        overlay.remove();
        _createThread(rootMsgId, title).catch(() => {});
    };
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
        overlay.classList.add('visible');
        document.getElementById('thread-title-input')?.focus();
    });

    // Enter to create
    const input = overlay.querySelector('#thread-title-input');
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                overlay.querySelector('[data-action="create"]').click();
            }
            if (e.key === 'Escape') overlay.remove();
        });
    }
}

async function _createThread(rootMsgId, title) {
    try {
        const resp = await fetch('/api/threads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Session-Token': window.SESSION_TOKEN },
            body: JSON.stringify({
                root_id: rootMsgId,
                title: title,
                created_by: window.username || 'user',
            }),
        });
        if (!resp.ok) {
            const errText = await resp.text();
            console.error('Failed to create thread:', resp.status, errText);
            return null;
        }
        const data = await resp.json();

        // Open the thread panel and show detail
        _ensurePanelOpen();
        _openThreadDetail(rootMsgId);

        // Add thread stub to root message in timeline
        const msgEl = document.querySelector(`.message[data-id="${rootMsgId}"]`);
        if (msgEl) {
            addThreadStubToMessage(msgEl, { reply_count: 0, status: data.status || 'open' });
        }
        return data;
    } catch (e) {
        console.error('Error creating thread:', e);
    }
    return null;
}

// ---------------------------------------------------------------------------
// Handle incoming thread messages (from WebSocket)
// ---------------------------------------------------------------------------

function _handleThreadMessage(msg) {
    // If we're viewing this thread, append the new message
    if (_currentThreadId && msg.thread_id === _currentThreadId) {
        const cached = _threadCache[_currentThreadId];
        if (cached) {
            cached.messages = cached.messages || [];
            cached.messages.push(msg);
            _renderThreadDetail(cached);
        }
    }

    // Update thread stub on root message if visible
    const rootEl = document.querySelector(`.message[data-id="${msg.thread_id}"]`);
    if (rootEl) {
        const existing = rootEl.querySelector('.thread-reply-badge');
        if (existing) {
            // Update reply count
            const current = parseInt(existing.textContent) || 0;
            const next = current + 1;
            existing.textContent = `${next} ${next === 1 ? 'reply' : 'replies'}`;
        } else {
            addThreadStubToMessage(rootEl, { reply_count: 1, status: 'open' });
        }
    }

    // Update badge count
    _updateThreadsBadge();
}

function _handleThreadUpdate(data) {
    const rootEl = document.querySelector(`.message[data-id="${data.root_id}"]`);
    if (rootEl) {
        addThreadStubToMessage(rootEl, data);
    }
    // Refresh thread list if panel is open
    if (_threadsPanelOpen && _threadsListView) {
        _loadThreadList();
    }
    // Update detail view if viewing this thread
    if (_currentThreadId === data.root_id) {
        if (_threadCache[_currentThreadId]) {
            Object.assign(_threadCache[_currentThreadId], data);
            _renderThreadDetail(_threadCache[_currentThreadId]);
        }
    }
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

function _updateThreadsBadge() {
    const badge = document.getElementById('threads-badge');
    if (!badge) return;
    const openCount = _threadIndex.filter(t => t.status === 'open').length;
    badge.textContent = String(openCount);
    badge.classList.toggle('hidden', openCount === 0);
}

// ---------------------------------------------------------------------------
// Refresh thread stubs on visible messages
// ---------------------------------------------------------------------------

async function _refreshThreadStubs() {
    const channel = window.activeChannel || 'general';
    try {
        const resp = await fetch(`/api/threads?channel=${encodeURIComponent(channel)}`, { 
            headers: { 'X-Session-Token': window.SESSION_TOKEN } 
        });
        if (!resp.ok) return;
        const threads = await resp.json();
        
        for (const thread of threads) {
            const rootId = thread.root_id;
            const replyCount = thread.reply_count || 0;
            const status = thread.status || 'open';
            
            const rootEl = document.querySelector(`.message[data-id="${rootId}"]`);
            if (rootEl) {
                const existing = rootEl.querySelector('.thread-reply-badge');
                if (!existing && replyCount > 0) {
                    addThreadStubToMessage(rootEl, { reply_count: replyCount, status });
                }
            }
        }
    } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Keyboard shortcut for reply input
// ---------------------------------------------------------------------------

function _setupThreadInput() {
    const input = document.getElementById('threads-detail-input-text');
    if (!input) return;

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendThreadReply();
        }
    });

    // Auto-resize
    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function _escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Init — hooks into chat.js WebSocket message handling
// ---------------------------------------------------------------------------

function _threadsInit() {
    _setupMessageContextMenu();
    _setupThreadInput();

    // Patch the WebSocket message handler to intercept thread-related messages
    // We wrap the ws.onmessage via a MutationObserver on the 'ws' property
    const _patchWs = () => {
        const ws = window.ws;
        if (!ws || ws._threadPatched) return;
        ws._threadPatched = true;

        const origOnMessage = ws.onmessage;
        ws.onmessage = function(event) {
            // Call original handler first
            if (origOnMessage) origOnMessage.call(ws, event);

            // Then handle thread-specific events
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'thread_update') {
                    _handleThreadUpdate(data.data);
                } else if (data.type === 'message' && data.data) {
                    const msg = data.data;
                    if (msg.thread_id) {
                        _handleThreadMessage(msg);
                    }
                }
            } catch (e) { /* ignore parse errors */ }
        };
    };

    // Poll for ws availability (it gets created async)
    const check = setInterval(() => {
        if (window.ws) {
            _patchWs();
            clearInterval(check);
        }
    }, 200);

    // Also patch on reconnect
    const origConnect = window.connectWebSocket;
    if (origConnect) {
        window.connectWebSocket = function() {
            origConnect();
            setTimeout(_patchWs, 500);
        };
    }
}

// Run init
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _threadsInit);
} else {
    _threadsInit();
}

// ---------------------------------------------------------------------------
// Window exports
// ---------------------------------------------------------------------------

window.toggleThreadsPanel = toggleThreadsPanel;
window.showThreadsFilter = showThreadsFilter;
window.closeThreadDetail = closeThreadDetail;
window.sendThreadReply = sendThreadReply;
window.addThreadStubToMessage = addThreadStubToMessage;
window.createThreadFromRoot = _createThread;
window.refreshThreadStubs = _refreshThreadStubs;

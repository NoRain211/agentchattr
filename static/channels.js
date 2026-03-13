// channels.js -- Channel tabs, switching, filtering, CRUD
// Extracted from chat.js PR 4.  Reads shared state via window.* bridges.

'use strict';

// ---------------------------------------------------------------------------
// State (local to channels)
// ---------------------------------------------------------------------------

const _channelScrollMsg = {};  // channel name -> message ID at top of viewport
let _inboxActive = false;
let _inboxData = null;
let _inboxTab = 'all';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _getTopVisibleMsgId() {
    const scroll = document.getElementById('timeline');
    const container = document.getElementById('messages');
    if (!scroll || !container) return null;
    const rect = scroll.getBoundingClientRect();
    for (const el of container.children) {
        if (el.style.display === 'none' || !el.dataset.id) continue;
        const elRect = el.getBoundingClientRect();
        if (elRect.bottom > rect.top) return el.dataset.id;
    }
    return null;
}

function _ensureInboxView() {
    let view = document.getElementById('inbox-view');
    if (view) return view;

    view = document.createElement('div');
    view.id = 'inbox-view';
    view.className = 'inbox-view hidden';

    const messages = document.getElementById('messages');
    if (messages && messages.parentNode) {
        messages.parentNode.insertBefore(view, messages);
    }
    return view;
}

function _showTimelineView() {
    const messages = document.getElementById('messages');
    const typing = document.getElementById('typing-indicator');
    const inboxView = _ensureInboxView();
    if (messages) messages.classList.remove('hidden');
    if (typing) typing.classList.remove('hidden');
    if (inboxView) inboxView.classList.add('hidden');
}

function _showInboxView() {
    const messages = document.getElementById('messages');
    const typing = document.getElementById('typing-indicator');
    const inboxView = _ensureInboxView();
    if (messages) messages.classList.add('hidden');
    if (typing) typing.classList.add('hidden');
    if (inboxView) inboxView.classList.remove('hidden');
}

function _setInboxActive(active) {
    _inboxActive = active;
    const inbox = document.getElementById('sidebar-inbox');
    if (inbox) inbox.classList.toggle('active', active);
    if (!active) {
        _showTimelineView();
    }
}

function _getInboxItems(data) {
    const mentions = (data && data.mentions) || [];
    const ownedThreads = (data && data.owned_threads) || [];
    const mentionItems = mentions.map(entry => ({
        key: `mention-${entry.message_id}`,
        kind: 'mention',
        sortId: entry.message_id,
        channel: entry.channel,
        title: entry.sender,
        subtitle: entry.is_broadcast ? 'Broadcast mention' : 'Mentioned you',
        preview: entry.text,
        time: entry.time || '',
        messageId: entry.message_id,
        threadRootId: entry.thread_root_id,
    }));
    const threadItems = ownedThreads.map(thread => ({
        key: `thread-${thread.root_id}`,
        kind: 'thread',
        sortId: thread.last_message_id,
        channel: thread.channel,
        title: thread.root_message?.sender || 'Thread',
        subtitle: thread.owner ? `Owned by ${thread.owner}` : 'Open thread',
        preview: thread.root_message?.text || '',
        time: thread.root_message?.time || '',
        rootId: thread.root_id,
        replyCount: thread.reply_count || 0,
        status: thread.status || 'open',
    }));
    return {
        all: [...mentionItems, ...threadItems].sort((a, b) => b.sortId - a.sortId),
        mentions: mentionItems.sort((a, b) => b.sortId - a.sortId),
        threads: threadItems.sort((a, b) => b.sortId - a.sortId),
    };
}

function _updateInboxBadge(data) {
    const badge = document.getElementById('inbox-badge');
    if (!badge) return;
    const total = ((data && data.mentions) || []).length + ((data && data.owned_threads) || []).length;
    badge.textContent = total > 99 ? '99+' : String(total);
    badge.classList.toggle('hidden', total === 0);
}

function _renderInboxEmpty(view, label) {
    view.innerHTML = `
        <div class="inbox-header">
            <div>
                <div class="inbox-title">Inbox</div>
                <div class="inbox-subtitle">${label}</div>
            </div>
        </div>
        <div class="pins-empty">No items yet.</div>
    `;
}

function _renderInboxCards(view, data) {
    const grouped = _getInboxItems(data);
    const items = grouped[_inboxTab] || grouped.all;
    if (items.length === 0) {
        _renderInboxEmpty(view, 'Nothing needs attention right now.');
        return;
    }

    const tabs = [
        { key: 'all', label: 'All', count: grouped.all.length },
        { key: 'mentions', label: 'Mentions', count: grouped.mentions.length },
        { key: 'threads', label: 'My Threads', count: grouped.threads.length },
    ];

    view.innerHTML = `
        <div class="inbox-header">
            <div>
                <div class="inbox-title">Inbox</div>
                <div class="inbox-subtitle">Attention view for @${window.escapeHtml(window.username || 'user')}</div>
            </div>
            <div class="inbox-tabs">
                ${tabs.map(tab => `
                    <button class="inbox-tab ${tab.key === _inboxTab ? 'active' : ''}" data-inbox-tab="${tab.key}">
                        <span>${tab.label}</span>
                        <span class="inbox-tab-badge">${tab.count}</span>
                    </button>
                `).join('')}
            </div>
        </div>
        <div class="inbox-cards">
            ${items.map(item => {
                const cardClass = item.kind === 'mention' ? 'inbox-card unread' : 'inbox-card thread';
                const preview = window.escapeHtml(item.preview || '');
                const subtitle = window.escapeHtml(item.subtitle || '');
                const title = window.escapeHtml(item.title || '');
                const channel = window.escapeHtml(item.channel || 'general');
                const meta = item.kind === 'thread'
                    ? `${item.replyCount} ${item.replyCount === 1 ? 'reply' : 'replies'}`
                    : `#${channel}`;
                return `
                    <button class="${cardClass}" data-kind="${item.kind}" data-channel="${channel}"
                        ${item.messageId ? `data-message-id="${item.messageId}"` : ''}
                        ${item.threadRootId ? `data-thread-root-id="${item.threadRootId}"` : ''}
                        ${item.rootId ? `data-root-id="${item.rootId}"` : ''}>
                        <div class="inbox-card-header">
                            <span class="inbox-card-title">${title}</span>
                            <span class="inbox-card-meta">${window.escapeHtml(meta)}</span>
                        </div>
                        <div class="inbox-card-subtitle">${subtitle}</div>
                        <div class="inbox-card-preview">${preview}</div>
                    </button>
                `;
            }).join('')}
        </div>
    `;

    for (const tab of view.querySelectorAll('[data-inbox-tab]')) {
        tab.addEventListener('click', () => {
            _inboxTab = tab.dataset.inboxTab;
            _renderInboxCards(view, data);
        });
    }

    for (const card of view.querySelectorAll('.inbox-card')) {
        card.addEventListener('click', () => {
            const channel = card.dataset.channel || 'general';
            const messageId = card.dataset.messageId ? parseInt(card.dataset.messageId, 10) : null;
            const rootId = card.dataset.rootId ? parseInt(card.dataset.rootId, 10)
                : card.dataset.threadRootId ? parseInt(card.dataset.threadRootId, 10) : null;
            _openInboxItem(channel, messageId, rootId);
        });
    }
}

function _expandThread(rootId) {
    if (!rootId) return;
    const group = document.querySelector(`.thread-group[data-thread-root="${rootId}"]`);
    if (!group) return;
    const toggle = group.querySelector('.thread-replies');
    const expanded = group.querySelector('.thread-expanded');
    if (toggle) toggle.classList.add('expanded');
    if (expanded) expanded.style.display = 'block';
}

function _openInboxItem(channel, messageId, rootId) {
    switchChannel(channel || 'general');
    requestAnimationFrame(() => {
        _expandThread(rootId);
        const targetId = messageId || rootId;
        if (targetId) scrollToMessage(targetId);
    });
}

async function refreshInboxView(options = {}) {
    const renderIfOpen = options.renderIfOpen !== false;
    const view = _ensureInboxView();
    try {
        const resp = await fetch(`/api/inbox?actor=${encodeURIComponent(window.username || 'user')}`, {
            headers: { 'X-Session-Token': window.SESSION_TOKEN },
        });
        if (!resp.ok) throw new Error(`Inbox request failed: ${resp.status}`);
        _inboxData = await resp.json();
        _updateInboxBadge(_inboxData);
        if (_inboxActive && renderIfOpen) {
            _showInboxView();
            _renderInboxCards(view, _inboxData);
        }
    } catch (err) {
        console.error('Failed to refresh inbox view:', err);
        if (_inboxActive && renderIfOpen) {
            _showInboxView();
            _renderInboxEmpty(view, 'Inbox failed to load.');
        }
    }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderChannelTabs() {
    const container = document.getElementById('channel-tabs');
    if (!container) return;

    // Preserve inline create input if it exists
    const existingCreate = container.querySelector('.channel-inline-create');
    container.innerHTML = '';

    for (const name of window.channelList) {
        const tab = document.createElement('button');
        tab.className = 'channel-tab' + (name === window.activeChannel ? ' active' : '');
        tab.dataset.channel = name;

        const label = document.createElement('span');
        label.className = 'channel-tab-label';
        label.textContent = '# ' + name;
        tab.appendChild(label);

        const unread = window.channelUnread[name] || 0;
        if (unread > 0 && name !== window.activeChannel) {
            const dot = document.createElement('span');
            dot.className = 'channel-unread-dot';
            dot.textContent = unread > 99 ? '99+' : unread;
            tab.appendChild(dot);
        }

        // Edit + delete icons for non-general tabs (visible on hover via CSS)
        if (name !== 'general') {
            const actions = document.createElement('span');
            actions.className = 'channel-tab-actions';

            const editBtn = document.createElement('button');
            editBtn.className = 'ch-edit-btn';
            editBtn.title = 'Rename';
            editBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
            editBtn.onclick = (e) => { e.stopPropagation(); showChannelRenameDialog(name); };
            actions.appendChild(editBtn);

            const delBtn = document.createElement('button');
            delBtn.className = 'ch-delete-btn';
            delBtn.title = 'Delete';
            delBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V3h4v1M5 4v8.5h6V4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            delBtn.onclick = (e) => { e.stopPropagation(); deleteChannel(name); };
            actions.appendChild(delBtn);

            tab.appendChild(actions);
        }

        tab.onclick = (e) => {
            if (e.target.closest('.channel-tab-actions')) return;
            if (name === window.activeChannel) {
                // Second click on active tab -- toggle edit controls
                tab.classList.toggle('editing');
            } else {
                // Clear any editing state, switch channel
                document.querySelectorAll('.channel-tab.editing').forEach(t => t.classList.remove('editing'));
                switchChannel(name);
            }
        };

        container.appendChild(tab);
    }

    // Re-append inline create if it was open
    if (existingCreate) {
        container.appendChild(existingCreate);
    }

    // Update add button disabled state
    const addBtn = document.getElementById('channel-add-btn');
    if (addBtn) {
        addBtn.classList.toggle('disabled', window.channelList.length >= 8);
    }
}

// ---------------------------------------------------------------------------
// Switch / filter
// ---------------------------------------------------------------------------

function switchChannel(name) {
    const wasInboxActive = _inboxActive;
    if (name === window.activeChannel && !wasInboxActive) return;
    _setInboxActive(false);
    // Clear inbox active state
    // Save top-visible message ID for current channel
    const topId = _getTopVisibleMsgId();
    if (topId) _channelScrollMsg[window.activeChannel] = topId;
    window._setActiveChannel(name);
    window.channelUnread[name] = 0;
    localStorage.setItem('agentchattr-channel', name);
    filterMessagesByChannel();
    renderChannelTabs();
    Store.set('activeChannel', name);
    // Restore: scroll to saved message, or bottom if none saved
    const savedId = _channelScrollMsg[name];
    if (savedId) {
        const el = document.querySelector(`.message[data-id="${savedId}"]`);
        if (el) { el.scrollIntoView({ block: 'start' }); return; }
    }
    window.scrollToBottom();
}

async function switchToInbox() {
    _setInboxActive(true);
    document.querySelectorAll('.channel-tab').forEach(t => t.classList.remove('active'));
    _showInboxView();
    const view = _ensureInboxView();
    _renderInboxEmpty(view, 'Loading inbox...');
    await refreshInboxView();
}

function filterMessagesByChannel() {
    if (_inboxActive) {
        _showInboxView();
        return;
    }
    _showTimelineView();
    const container = document.getElementById('messages');
    if (!container) return;

    for (const el of container.children) {
        const ch = el.dataset.channel || 'general';
        el.style.display = ch === window.activeChannel ? '' : 'none';
    }
}

// ---------------------------------------------------------------------------
// Thread grouping — groups reply chains under root messages
// ---------------------------------------------------------------------------

function groupThreadsInTimeline() {
    const container = document.getElementById('messages');
    if (!container) return;

    // Build reply map: rootId -> [replyElements]
    const replyMap = new Map();
    const rootElements = new Map();

    for (const el of Array.from(container.children)) {
        if (!el.dataset || !el.dataset.id) continue;
        const replyTo = el.dataset.replyTo;
        if (replyTo) {
            if (!replyMap.has(replyTo)) replyMap.set(replyTo, []);
            replyMap.get(replyTo).push(el);
        }
        rootElements.set(el.dataset.id, el);
    }

    // For each root that has replies, wrap in a thread group
    for (const [rootId, replies] of replyMap) {
        const rootEl = rootElements.get(rootId);
        if (!rootEl || rootEl.closest('.thread-group')) continue;

        // Create thread group container
        const group = document.createElement('div');
        group.className = 'thread-group';
        group.dataset.threadRoot = rootId;

        // Mark root
        rootEl.classList.add('thread-root');

        // Insert group before root in DOM
        rootEl.parentNode.insertBefore(group, rootEl);
        group.appendChild(rootEl);

        // Add reply count toggle (uses Kimi's .thread-replies style)
        const toggleBar = document.createElement('div');
        toggleBar.className = 'thread-replies';
        toggleBar.innerHTML = `<span class="chevron">&#x25BC;</span> ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`;

        // Create expanded container (hidden by default)
        const expandedDiv = document.createElement('div');
        expandedDiv.className = 'thread-expanded';
        expandedDiv.style.display = 'none';

        toggleBar.onclick = () => {
            const isExpanded = expandedDiv.style.display !== 'none';
            expandedDiv.style.display = isExpanded ? 'none' : 'block';
            toggleBar.classList.toggle('expanded', !isExpanded);
        };
        group.appendChild(toggleBar);

        // Move replies into the expanded container
        for (const reply of replies) {
            reply.classList.add('thread-reply');
            expandedDiv.appendChild(reply);
        }
        group.appendChild(expandedDiv);
    }
}

// Re-run thread grouping after message filtering
const _origFilter = filterMessagesByChannel;
filterMessagesByChannel = function() {
    _origFilter();
    if (_inboxActive) return;
    // Ungroup first to avoid nesting issues on re-filter
    ungroupThreads();
    groupThreadsInTimeline();
};

function ungroupThreads() {
    const container = document.getElementById('messages');
    if (!container) return;
    for (const group of Array.from(container.querySelectorAll('.thread-group'))) {
        // Move children back to the main container
        while (group.firstChild) {
            const child = group.firstChild;
            child.classList.remove('thread-root', 'thread-reply');
            group.parentNode.insertBefore(child, group);
        }
        group.remove();
    }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

function showChannelCreateDialog() {
    if (window.channelList.length >= 8) return;
    const tabs = document.getElementById('channel-tabs');
    // Remove existing inline create if any
    tabs.querySelector('.channel-inline-create')?.remove();

    // Hide the + button while creating
    const addBtn = document.getElementById('channel-add-btn');
    if (addBtn) addBtn.style.display = 'none';

    const wrapper = document.createElement('div');
    wrapper.className = 'channel-inline-create';

    const prefix = document.createElement('span');
    prefix.className = 'channel-input-prefix';
    prefix.textContent = '#';
    wrapper.appendChild(prefix);

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 20;
    input.placeholder = 'channel-name';
    wrapper.appendChild(input);

    const cleanup = () => { wrapper.remove(); if (addBtn) addBtn.style.display = ''; };

    const confirm = document.createElement('button');
    confirm.className = 'confirm-btn';
    confirm.innerHTML = '&#10003;';
    confirm.title = 'Create';
    confirm.onclick = () => { _submitInlineCreate(input, wrapper); if (addBtn) addBtn.style.display = ''; };
    wrapper.appendChild(confirm);

    const cancel = document.createElement('button');
    cancel.className = 'cancel-btn';
    cancel.innerHTML = '&#10005;';
    cancel.title = 'Cancel';
    cancel.onclick = cleanup;
    wrapper.appendChild(cancel);

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); _submitInlineCreate(input, wrapper); if (addBtn) addBtn.style.display = ''; }
        if (e.key === 'Escape') cleanup();
    });
    input.addEventListener('input', () => {
        input.value = input.value.toLowerCase().replace(/[^a-z0-9\-]/g, '');
    });

    tabs.appendChild(wrapper);
    input.focus();
}

function _submitInlineCreate(input, wrapper) {
    const name = input.value.trim().toLowerCase();
    if (!name || !/^[a-z0-9][a-z0-9\-]{0,19}$/.test(name)) return;
    if (window.channelList.includes(name)) { input.focus(); return; }
    window._setPendingChannelSwitch(name);
    window.ws.send(JSON.stringify({ type: 'channel_create', name }));
    wrapper.remove();
}

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

function showChannelRenameDialog(oldName) {
    const tabs = document.getElementById('channel-tabs');
    tabs.querySelector('.channel-inline-create')?.remove();

    const wrapper = document.createElement('div');
    wrapper.className = 'channel-inline-create';

    const prefix = document.createElement('span');
    prefix.className = 'channel-input-prefix';
    prefix.textContent = '#';
    wrapper.appendChild(prefix);

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 20;
    input.value = oldName;
    wrapper.appendChild(input);

    const confirm = document.createElement('button');
    confirm.className = 'confirm-btn';
    confirm.innerHTML = '&#10003;';
    confirm.title = 'Rename';
    confirm.onclick = () => {
        const newName = input.value.trim().toLowerCase();
        if (!newName || !/^[a-z0-9][a-z0-9\-]{0,19}$/.test(newName)) return;
        if (newName !== oldName) {
            window.ws.send(JSON.stringify({ type: 'channel_rename', old_name: oldName, new_name: newName }));
            if (window.activeChannel === oldName) {
                window._setActiveChannel(newName);
                localStorage.setItem('agentchattr-channel', newName);
                Store.set('activeChannel', newName);
            }
        }
        wrapper.remove();
    };
    wrapper.appendChild(confirm);

    const cancel = document.createElement('button');
    cancel.className = 'cancel-btn';
    cancel.innerHTML = '&#10005;';
    cancel.title = 'Cancel';
    cancel.onclick = () => wrapper.remove();
    wrapper.appendChild(cancel);

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); confirm.click(); }
        if (e.key === 'Escape') wrapper.remove();
    });
    input.addEventListener('input', () => {
        input.value = input.value.toLowerCase().replace(/[^a-z0-9\-]/g, '');
    });

    tabs.appendChild(wrapper);
    input.select();
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

function deleteChannel(name) {
    if (name === 'general') return;
    const tab = document.querySelector(`.channel-tab[data-channel="${name}"]`);
    if (!tab || tab.classList.contains('confirm-delete')) return;

    const label = tab.querySelector('.channel-tab-label');
    const actions = tab.querySelector('.channel-tab-actions');
    const originalText = label.textContent;
    const originalOnclick = tab.onclick;

    tab.classList.add('confirm-delete');
    tab.classList.remove('editing');
    label.textContent = `delete #${name}?`;
    if (actions) actions.style.display = 'none';

    const confirmBar = document.createElement('span');
    confirmBar.className = 'channel-delete-confirm';

    const tickBtn = document.createElement('button');
    tickBtn.className = 'ch-confirm-yes';
    tickBtn.title = 'Confirm delete';
    tickBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.5 3.5 6.5-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    const crossBtn = document.createElement('button');
    crossBtn.className = 'ch-confirm-no';
    crossBtn.title = 'Cancel';
    crossBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

    confirmBar.appendChild(tickBtn);
    confirmBar.appendChild(crossBtn);
    tab.appendChild(confirmBar);

    const revert = () => {
        tab.classList.remove('confirm-delete');
        label.textContent = originalText;
        if (actions) actions.style.display = '';
        confirmBar.remove();
        tab.onclick = originalOnclick;
        document.removeEventListener('click', outsideClick);
    };

    tickBtn.onclick = (e) => {
        e.stopPropagation();
        revert();
        window.ws.send(JSON.stringify({ type: 'channel_delete', name }));
        if (window.activeChannel === name) switchChannel('general');
    };

    crossBtn.onclick = (e) => {
        e.stopPropagation();
        revert();
    };

    tab.onclick = (e) => { e.stopPropagation(); };

    const outsideClick = (e) => {
        if (!tab.contains(e.target)) revert();
    };
    setTimeout(() => document.addEventListener('click', outsideClick), 0);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function _channelsInit() {
    // Nothing to do yet -- channel rendering is driven by chat.js calling
    // renderChannelTabs() and filterMessagesByChannel() at the right times.
    _ensureInboxView();
}

// ---------------------------------------------------------------------------
// Window exports (for inline onclick in index.html and chat.js callers)
// ---------------------------------------------------------------------------

window.showChannelCreateDialog = showChannelCreateDialog;
window.switchChannel = switchChannel;
window.filterMessagesByChannel = filterMessagesByChannel;
window.renderChannelTabs = renderChannelTabs;
window.deleteChannel = deleteChannel;
window.showChannelRenameDialog = showChannelRenameDialog;
window.refreshInboxView = refreshInboxView;
window.Channels = { init: _channelsInit };

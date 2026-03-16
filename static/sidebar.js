// sidebar.js -- Archived channels section + sidebar collapse
// Reads archived_channels from settings broadcasts, renders below active channel tabs.

'use strict';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _archivedChannels = [];
let _archivedCollapsed = localStorage.getItem('agentchattr-archived-collapsed') === 'true';

// ---------------------------------------------------------------------------
// Render archived section
// ---------------------------------------------------------------------------

function renderArchivedSection() {
    const container = document.getElementById('channel-tabs');
    if (!container) return;

    // Remove existing archived section
    container.querySelector('.archived-section')?.remove();

    if (_archivedChannels.length === 0) return;

    const section = document.createElement('div');
    section.className = 'archived-section';

    // Header
    const header = document.createElement('div');
    header.className = 'archived-header' + (_archivedCollapsed ? ' collapsed' : '');
    header.innerHTML = '<span>ARCHIVED</span><span class="toggle-icon">&#9662;</span>';
    header.onclick = () => {
        _archivedCollapsed = !_archivedCollapsed;
        localStorage.setItem('agentchattr-archived-collapsed', _archivedCollapsed);
        header.classList.toggle('collapsed', _archivedCollapsed);
        channelsDiv.classList.toggle('collapsed', _archivedCollapsed);
    };
    section.appendChild(header);

    // Channel list
    const channelsDiv = document.createElement('div');
    channelsDiv.className = 'archived-channels' + (_archivedCollapsed ? ' collapsed' : '');

    for (const name of _archivedChannels) {
        const tab = document.createElement('button');
        tab.className = 'channel-tab archived';
        tab.dataset.channel = name;

        const label = document.createElement('span');
        label.className = 'channel-tab-label';
        label.textContent = '# ' + name;
        tab.appendChild(label);

        // Right-click or click to show context menu
        tab.oncontextmenu = (e) => {
            e.preventDefault();
            _showArchivedContextMenu(e, name);
        };
        tab.onclick = () => {
            _showArchivedContextMenu({ clientX: tab.getBoundingClientRect().right, clientY: tab.getBoundingClientRect().top }, name);
        };

        channelsDiv.appendChild(tab);
    }

    section.appendChild(channelsDiv);
    container.appendChild(section);
}

// ---------------------------------------------------------------------------
// Context menu for archived channels
// ---------------------------------------------------------------------------

function _showArchivedContextMenu(e, channelName) {
    _closeContextMenus();

    const menu = document.createElement('div');
    menu.className = 'channel-context-menu';
    menu.style.position = 'fixed';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    const unarchiveBtn = document.createElement('button');
    unarchiveBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8l5-5 5 5M8 3v10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg> Unarchive';
    unarchiveBtn.onclick = () => {
        window.ws.send(JSON.stringify({ type: 'channel_unarchive', name: channelName }));
        menu.remove();
    };
    menu.appendChild(unarchiveBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete';
    deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V3h4v1M5 4v8.5h6V4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg> Delete permanently';
    deleteBtn.onclick = () => {
        menu.remove();
        _showDeleteConfirmModal(channelName);
    };
    menu.appendChild(deleteBtn);

    document.body.appendChild(menu);
    // Show with animation
    requestAnimationFrame(() => menu.classList.add('visible'));

    // Close on outside click
    const close = (ev) => {
        if (!menu.contains(ev.target)) {
            menu.remove();
            document.removeEventListener('click', close);
        }
    };
    setTimeout(() => document.addEventListener('click', close), 0);
}

function _closeContextMenus() {
    document.querySelectorAll('.channel-context-menu').forEach(m => m.remove());
}

// ---------------------------------------------------------------------------
// Context menu for active channels
// ---------------------------------------------------------------------------

function _showActiveChannelContextMenu(e, channelName) {
    if (channelName === 'general') return;
    _closeContextMenus();

    const menu = document.createElement('div');
    menu.className = 'channel-context-menu';
    menu.style.position = 'fixed';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    // Archive button
    const archiveBtn = document.createElement('button');
    archiveBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg> Archive channel';
    archiveBtn.onclick = () => {
        menu.remove();
        archiveChannel(channelName);
    };
    menu.appendChild(archiveBtn);

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete';
    deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V3h4v1M5 4v8.5h6V4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg> Delete permanently';
    deleteBtn.onclick = () => {
        menu.remove();
        _showDeleteConfirmModal(channelName);
    };
    menu.appendChild(deleteBtn);

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

// ---------------------------------------------------------------------------
// Delete confirmation modal (for permanent delete of archived channel)
// ---------------------------------------------------------------------------

function _showDeleteConfirmModal(channelName) {
    const overlay = document.createElement('div');
    overlay.className = 'archive-modal-overlay';
    overlay.innerHTML = `
        <div class="archive-modal">
            <h3>Delete #${channelName}?</h3>
            <p>This will permanently delete the channel and all its messages. This cannot be undone.</p>
            <div class="archive-modal-actions">
                <button class="btn-secondary" data-action="cancel">Cancel</button>
                <button class="btn-danger" data-action="delete">Delete</button>
            </div>
        </div>`;

    overlay.querySelector('[data-action="cancel"]').onclick = () => overlay.remove();
    overlay.querySelector('[data-action="delete"]').onclick = () => {
        window.ws.send(JSON.stringify({ type: 'channel_delete', name: channelName }));
        overlay.remove();
    };
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));
}

// ---------------------------------------------------------------------------
// Archive action (called from active channel context)
// ---------------------------------------------------------------------------

function archiveChannel(name) {
    if (name === 'general') return;
    window.ws.send(JSON.stringify({ type: 'channel_archive', name }));
    if (window.activeChannel === name) {
        window.switchChannel('general');
    }
}

// ---------------------------------------------------------------------------
// Patch channels.js delete to offer archive-first
// ---------------------------------------------------------------------------

function _patchChannelDelete() {
    const originalDelete = window.deleteChannel;
    if (!originalDelete) return;

    window.deleteChannel = function(name) {
        if (name === 'general') return;

        const tab = document.querySelector(`.channel-tab[data-channel="${name}"]`);
        if (!tab || tab.classList.contains('confirm-delete')) return;

        const label = tab.querySelector('.channel-tab-label');
        const actions = tab.querySelector('.channel-tab-actions');
        const originalText = label.textContent;
        const originalOnclick = tab.onclick;

        tab.classList.add('confirm-delete');
        tab.classList.remove('editing');
        label.textContent = `archive #${name}?`;
        if (actions) actions.style.display = 'none';

        const confirmBar = document.createElement('span');
        confirmBar.className = 'channel-delete-confirm';

        // Archive button (checkmark)
        const archiveBtn = document.createElement('button');
        archiveBtn.className = 'ch-confirm-yes';
        archiveBtn.title = 'Archive';
        archiveBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.5 3.5 6.5-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

        // Cancel button
        const crossBtn = document.createElement('button');
        crossBtn.className = 'ch-confirm-no';
        crossBtn.title = 'Cancel';
        crossBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

        confirmBar.appendChild(archiveBtn);
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

        archiveBtn.onclick = (e) => {
            e.stopPropagation();
            revert();
            archiveChannel(name);
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
    };
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function _setupActiveChannelContextMenu() {
    const container = document.getElementById('channel-tabs');
    if (!container) return;

    // Use event delegation for active channel right-clicks
    container.addEventListener('contextmenu', (e) => {
        const tab = e.target.closest('.channel-tab');
        if (!tab) return;
        // Skip archived channels (they have their own handler)
        if (tab.classList.contains('archived')) return;
        // Skip the inline create input
        if (tab.classList.contains('channel-inline-create')) return;

        const channelName = tab.dataset.channel;
        if (!channelName || channelName === 'general') return;

        e.preventDefault();
        _showActiveChannelContextMenu(e, channelName);
    });
}

function _sidebarInit() {
    _patchChannelDelete();
    _setupActiveChannelContextMenu();

    // Wrap renderChannelTabs to also render archived section after each update.
    // chat.js exposes window._archivedChannels from settings broadcasts.
    const origRender = window.renderChannelTabs;
    if (origRender) {
        window.renderChannelTabs = function() {
            origRender();
            _archivedChannels = window._archivedChannels || [];
            renderArchivedSection();
        };
    }
}

// Run init when DOM is ready (sidebar.js loads after chat.js)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _sidebarInit);
} else {
    _sidebarInit();
}

// ---------------------------------------------------------------------------
// Window exports
// ---------------------------------------------------------------------------

window.archiveChannel = archiveChannel;
window.renderArchivedSection = renderArchivedSection;

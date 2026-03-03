export function createModalOverlay({ id = null, zIndex = null } = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    if (id) overlay.id = id;
    if (zIndex !== null) overlay.style.zIndex = String(zIndex);
    return overlay;
}

export default createModalOverlay;

export function loadImageInto(container, src, fallbackText, fallbackClass = null) {
    if (!container) return;

    const img = new Image();
    img.src = src;

    img.onload = () => {
        container.innerHTML = '';
        container.appendChild(img);
    };

    img.onerror = () => {
        if (fallbackClass) {
            container.innerHTML = `<div class="${fallbackClass}">${fallbackText}</div>`;
        } else {
            container.textContent = fallbackText;
        }
    };

    if (fallbackClass) {
        container.innerHTML = `<div class="${fallbackClass}">${fallbackText}</div>`;
    } else {
        container.textContent = fallbackText;
    }
}

export function showTooltip({ id, title, cost, description, x, y, offsetX = 10, offsetY = 10 }) {
    hideTooltip(id);

    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    tooltip.id = id;

    tooltip.innerHTML = `
        <div class="tooltip-title">${title}</div>
        <div class="tooltip-cost">Cost: ${cost} mana</div>
        <div class="tooltip-description">${description || ''}</div>
    `;

    tooltip.style.left = `${x + offsetX}px`;
    tooltip.style.top = `${y + offsetY}px`;

    document.body.appendChild(tooltip);
}

export function hideTooltip(id) {
    const existing = document.getElementById(id);
    if (existing) {
        existing.remove();
    }
}

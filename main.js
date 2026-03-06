function getYesterdayBalance(companyIdx, branchIdx = null) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    if (dailyHistory[yesterday] && dailyHistory[yesterday][`company_${companyIdx}`]) {
        const companyData = dailyHistory[yesterday][`company_${companyIdx}`];
        if (branchIdx !== null) {
            const branchData = companyData.branches[`branch_${branchIdx}`];
            return branchData ? branchData.balance : 0;
        }
        return companyData.totalBalance;
    }
    return 0;
}

function quickAddBalance() {
    const branch = companies[currentCompanyIdx].branches[currentBranchIdx];
    const amount = getCurrencyValue(document.getElementById('quickBalanceInput'));
    if (amount <= 0) {
        showToast('error', 'Valor InvÃ¡lido', 'Insira um valor maior que zero.');
        return;
    }
    branch.balance += amount;
    addAuditEntry('Recarga RÃ¡pida', `${branch.name}: +${formatCurrency(amount)}`, 'success');
    showToast('success', 'Saldo Adicionado', `${formatCurrency(amount)} adicionados com sucesso.`);
    save();
    renderBranch();
}

// ============================================================
// ESTADO GLOBAL
// ============================================================
let companies = JSON.parse(localStorage.getItem('trafficflow_v8_companies')) || [];
let branchSearchTerm = '';
let branchSortOrder = 'name-asc'; // name-asc, name-desc, balance-asc, balance-desc
let auditLog = JSON.parse(localStorage.getItem('trafficflow_v8_audit')) || [];
let notifications = JSON.parse(localStorage.getItem('trafficflow_v8_notifs')) || [];
let alertSettings = JSON.parse(localStorage.getItem('trafficflow_v8_alertSettings')) || { roiThreshold: 0, budgetThreshold: 90, balanceDays: 7 };
let kpiOrder = JSON.parse(localStorage.getItem('trafficflow_v8_kpiOrder')) || ['balance', 'roi', 'spend', 'revenue', 'ticket', 'payback'];

let currentView = 'companies';
let currentCompanyIdx = null;
let currentBranchIdx = null;
let currentCampaignPurpose = 'vendas';
let filterPeriod = localStorage.getItem('trafficflow_v8_filterPeriod') || 'all';
let hasInstallment = false;
let dismissedAlerts = JSON.parse(localStorage.getItem('trafficflow_v8_dismissed_alerts')) || [];

function dismissAlert(id) {
    if (!dismissedAlerts.includes(id)) {
        dismissedAlerts.push(id);
        localStorage.setItem('trafficflow_v8_dismissed_alerts', JSON.stringify(dismissedAlerts));
    }

    // Atualiza todos os possÃ­veis containers de alerta
    if (typeof displaySmartAlerts === 'function') displaySmartAlerts();
    if (typeof displayAlerts === 'function') displayAlerts();

    // Feedback visual imediato para o elemento que disparou o evento
    if (window.event) {
        const btn = window.event.currentTarget;
        if (btn) {
            const alertEl = btn.closest('.alert-banner') || btn.closest('.smart-alert') || btn.parentElement;
            if (alertEl && alertEl.classList) {
                alertEl.style.opacity = '0';
                alertEl.style.transform = 'translateX(20px)';
                setTimeout(() => alertEl.remove(), 300);
            }
        }
    }
}

let editingItem = null; // { type: 'company'|'branch'|'sale', idx, ... }
let dailyHistory = JSON.parse(localStorage.getItem('trafficflow_v8_daily_history')) || {}; // HistÃ³rico diÃ¡rio de mÃ©tricas
let visibleKPIs = JSON.parse(localStorage.getItem('trafficflow_v8_visible_kpis')) || ['balance', 'roi', 'spend', 'revenue'];
let kpiPositions = JSON.parse(localStorage.getItem('trafficflow_v8_kpi_positions')) || {}; // PosiÃ§Ãµes customizadas dos KPIs
let whiteLabel = {
    brandName: localStorage.getItem('tf_brandName') || 'TrafficFlow Ultimate',
    logoUrl: localStorage.getItem('tf_logoUrl') || '',
    primaryColor: localStorage.getItem('tf_primaryColor') || '#00d4ff'
};





// ============================================================
// MICRO-INTERAÃ‡Ã•ES E FEEDBACK VISUAL
// ============================================================

// Efeito de ripple ao clicar em botÃµes
document.addEventListener('click', function (e) {
    if (e.target.classList.contains('btn') || e.target.closest('.btn')) {
        const btn = e.target.classList.contains('btn') ? e.target : e.target.closest('.btn');
        const ripple = document.createElement('span');
        ripple.style.position = 'absolute';
        ripple.style.borderRadius = '50%';
        ripple.style.background = 'rgba(255, 255, 255, 0.5)';
        ripple.style.width = ripple.style.height = '20px';
        ripple.style.pointerEvents = 'none';
        ripple.style.animation = 'ripple 0.6s ease-out';
        btn.style.position = 'relative';
        btn.style.overflow = 'hidden';
        btn.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
    }
});

// Feedback de carregamento
function showLoadingState(btn) {
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processando...';
    return () => {
        btn.disabled = false;
        btn.innerHTML = originalText;
    };
}

// AnimaÃ§Ã£o de sucesso
function showSuccessAnimation(element) {
    element.style.animation = 'successPulse 0.6s ease';
    setTimeout(() => element.style.animation = '', 600);
}


// Hover effects para cards
document.querySelectorAll('.card, .campaign-card').forEach(card => {
    card.addEventListener('mouseenter', function () {
        this.style.transition = 'all 0.3s cubic-bezier(0.23, 1, 0.32, 1)';
        this.style.transform = 'translateY(-4px)';
    });
    card.addEventListener('mouseleave', function () {
        this.style.transform = 'translateY(0)';
    });
});


// ============================================================
// SISTEMA DE UNDO (DESFAZER)
// ============================================================
let undoStack = [];
let maxUndoSteps = 20;

function saveUndoState(action, data) {
    undoStack.push({ action, data, timestamp: Date.now() });
    if (undoStack.length > maxUndoSteps) undoStack.shift();
}

function undo() {
    if (undoStack.length === 0) {
        showToast('warning', 'Nada para desfazer', 'NÃ£o hÃ¡ aÃ§Ãµes anteriores.');
        return;
    }
    const lastAction = undoStack.pop();
    showToast('info', 'Desfeito', `AÃ§Ã£o revertida: ${lastAction.action}`);
}

// Atalho de teclado Ctrl+Z / Cmd+Z
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
    }
});


// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
function showToast(type, title, message, duration = 4000) {
    const icons = { success: 'check-circle', error: 'times-circle', warning: 'exclamation-triangle', info: 'info-circle' };
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
        <i class="fas fa-${icons[type]} toast-icon" aria-hidden="true"></i>
        <div class="toast-body">
            <div class="toast-title">${title}</div>
            ${message ? `<div class="toast-message">${message}</div>` : ''}
        </div>
        <button class="toast-close" onclick="dismissToast(this.parentElement)" aria-label="Fechar notificaÃ§Ã£o">
            <i class="fas fa-times"></i>
        </button>
    `;
    container.appendChild(toast);
    setTimeout(() => dismissToast(toast), duration);
}

function dismissToast(toast) {
    if (!toast || !toast.parentElement) return;
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 350);
}

// ============================================================
// CONFIRM DIALOG (substitui alert/confirm)
// ============================================================
function showConfirm(title, message, icon, onConfirm, confirmText = 'Confirmar', confirmClass = 'btn-danger') {
    const container = document.getElementById('confirmContainer');
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
        <div class="confirm-box" role="alertdialog" aria-modal="true" aria-labelledby="confirmTitle">
            <div class="confirm-icon">${icon}</div>
            <div class="confirm-title" id="confirmTitle">${title}</div>
            <div class="confirm-message">${message}</div>
            <div class="confirm-actions">
                <button class="btn ${confirmClass}" id="confirmOkBtn">${confirmText}</button>
                <button class="btn btn-secondary" onclick="this.closest('.confirm-overlay').remove()">Cancelar</button>
            </div>
        </div>
    `;
    container.appendChild(overlay);
    overlay.querySelector('#confirmOkBtn').onclick = () => {
        overlay.remove();
        onConfirm();
    };
    overlay.querySelector('#confirmOkBtn').focus();
}

// ============================================================
// AUDIT LOG
// ============================================================
function addAuditEntry(action, detail, type = 'info') {
    const entry = {
        id: Date.now(),
        action,
        detail,
        type,
        timestamp: new Date().toISOString(),
        user: whiteLabel.brandName
    };
    auditLog.unshift(entry);
    if (auditLog.length > 500) auditLog = auditLog.slice(0, 500);
    localStorage.setItem('trafficflow_v8_audit', JSON.stringify(auditLog));
}

function renderAuditLog(filter = '') {
    const container = document.getElementById('auditContainer');
    if (!container) return;
    const filtered = filter
        ? auditLog.filter(e => e.action.toLowerCase().includes(filter.toLowerCase()) || e.detail.toLowerCase().includes(filter.toLowerCase()))
        : auditLog;

    if (filtered.length === 0) {
        container.innerHTML = '<div class="no-branches-message">Nenhum registro encontrado.</div>';
        return;
    }

    const typeColors = { success: 'var(--secondary)', error: 'var(--danger)', warning: 'var(--warning)', info: 'var(--primary)', delete: 'var(--danger)' };
    const typeIcons = { success: 'check', error: 'times', warning: 'exclamation', info: 'info', delete: 'trash' };

    container.innerHTML = filtered.slice(0, 100).map(entry => {
        const color = typeColors[entry.type] || 'var(--primary)';
        const icon = typeIcons[entry.type] || 'info';
        const time = new Date(entry.timestamp).toLocaleString('pt-BR');
        return `
            <div class="audit-item">
                <div class="audit-icon" style="background: ${color}22; color: ${color};">
                    <i class="fas fa-${icon}"></i>
                </div>
                <div class="audit-content">
                    <div class="audit-action">${entry.action}</div>
                    <div class="audit-detail">${entry.detail}</div>
                </div>
                <div class="audit-time">${time}</div>
            </div>
        `;
    }).join('');
}

function filterAuditLog(value) { renderAuditLog(value); }

// ============================================================
// VALIDAÃ‡ÃƒO DE FORMULÃRIOS EM TEMPO REAL
// ============================================================
function setFieldState(inputId, iconId, errorId, isValid, errorMsg) {
    const input = document.getElementById(inputId);
    const icon = document.getElementById(iconId);
    const error = document.getElementById(errorId);
    if (!input) return;
    input.classList.toggle('error', !isValid);
    input.classList.toggle('success', isValid);
    if (icon) {
        icon.className = `form-input-icon ${isValid ? 'valid' : 'invalid'}`;
        icon.innerHTML = isValid ? '<i class="fas fa-check-circle"></i>' : '<i class="fas fa-exclamation-circle"></i>';
    }
    if (error) {
        error.classList.toggle('hidden', isValid);
        if (!isValid) error.querySelector('span').textContent = errorMsg;
    }
}

function validateField1() {
    const val = document.getElementById('field1Input').value.trim();
    setFieldState('field1Input', 'field1Icon', 'field1Error', val.length >= 2, 'Nome deve ter pelo menos 2 caracteres');
}

function validateCampaignName() {
    const val = document.getElementById('campaignNameInput').value.trim();
    setFieldState('campaignNameInput', 'campaignNameIcon', 'campaignNameError', val.length >= 3, 'Nome deve ter pelo menos 3 caracteres');
}

function validateCampaignSpend() {
    const val = parseFloat(document.getElementById('campaignSpendInput').value);
    setFieldState('campaignSpendInput', 'campaignSpendIcon', 'campaignSpendError', val > 0, 'Gasto deve ser maior que zero');
}

function validateSaleField(inputId, errorId, iconId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const val = input.value.trim();
    const isNum = input.type === 'number';
    const isValid = isNum ? parseFloat(val) > 0 : val.length >= 2;
    const msg = isNum ? 'Valor deve ser maior que zero' : 'Campo obrigatÃ³rio (mÃ­n. 2 caracteres)';
    setFieldState(inputId, iconId, errorId, isValid, msg);
}

// ============================================================
// PERSISTÃŠNCIA
// ============================================================
// Registrar histÃ³rico diÃ¡rio de mÃ©tricas
function recordDailyMetrics() {
    const today = new Date().toISOString().split('T')[0];
    if (!dailyHistory[today]) {
        dailyHistory[today] = {};
    }

    companies.forEach((company, cIdx) => {
        const key = `company_${cIdx}`;

        // Reset/Initialize daily data for this company to prevent infinite accumulation when saving multiple times a day
        dailyHistory[today][key] = {
            totalBalance: 0,
            totalSpend: 0,
            totalRevenue: 0,
            branches: {}
        };

        company.branches.forEach((branch, bIdx) => {
            const branchKey = `branch_${bIdx}`;
            const branchDaily = branch.campaigns.reduce((s, c) => s + (c.spend || 0), 0);
            const branchRevenue = branch.sales.reduce((s, s2) => s + (s2.totalLTV || 0), 0);

            dailyHistory[today][key].totalBalance += branch.balance || 0;
            dailyHistory[today][key].totalSpend += branchDaily;
            dailyHistory[today][key].totalRevenue += branchRevenue;

            dailyHistory[today][key].branches[branchKey] = {
                balance: branch.balance || 0,
                spend: branchDaily,
                revenue: branchRevenue
            };
        });
    });

    localStorage.setItem('trafficflow_v8_daily_history', JSON.stringify(dailyHistory));
}

function save() {
    localStorage.setItem('trafficflow_v8_companies', JSON.stringify(companies));
    localStorage.setItem('trafficflow_v8_dismissed_alerts', JSON.stringify(dismissedAlerts));
    localStorage.setItem('trafficflow_v8_visible_kpis', JSON.stringify(visibleKPIs));
    localStorage.setItem('trafficflow_v8_kpi_positions', JSON.stringify(kpiPositions));
    recordDailyMetrics();
    render();
}

function saveNotifications() {
    localStorage.setItem('trafficflow_v8_notifs', JSON.stringify(notifications));
}
// FunÃ§Ã£o para obter dados de tendÃªncia dos Ãºltimos 7 dias
function getTrendData(metric, companyIdx, branchIdx = null) {
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        last7Days.push(dateStr);
    }

    const values = [];
    last7Days.forEach(date => {
        if (dailyHistory[date] && dailyHistory[date][`company_${companyIdx}`]) {
            const companyData = dailyHistory[date][`company_${companyIdx}`];
            if (branchIdx !== null) {
                const branchData = companyData.branches[`branch_${branchIdx}`];
                if (branchData) {
                    switch (metric) {
                        case 'spend': values.push(branchData.spend); break;
                        case 'revenue': values.push(branchData.revenue); break;
                        case 'balance': values.push(branchData.balance); break;
                        default: values.push(0);
                    }
                } else {
                    values.push(0);
                }
            } else {
                switch (metric) {
                    case 'spend': values.push(companyData.totalSpend); break;
                    case 'revenue': values.push(companyData.totalRevenue); break;
                    case 'balance': values.push(companyData.totalBalance); break;
                    default: values.push(0);
                }
            }
        } else {
            values.push(0);
        }
    });

    return values;
}

// FunÃ§Ã£o para gerar ID Ãºnico para cada grÃ¡fico
function getChartId(metric, companyIdx, branchIdx = null) {
    return `chart_${metric}_${companyIdx}_${branchIdx || 'company'}`;
}

// FunÃ§Ã£o para renderizar mini-grÃ¡fico de tendÃªncia
function renderTrendChart(metric, companyIdx, branchIdx = null, containerId) {
    const chartId = getChartId(metric, companyIdx, branchIdx);
    const container = document.getElementById(containerId);
    if (!container) return;

    // Criar canvas para o grÃ¡fico
    const canvas = document.createElement('canvas');
    canvas.id = chartId;
    canvas.style.maxHeight = '40px';
    canvas.style.marginTop = '8px';
    container.appendChild(canvas);

    // Dados de tendÃªncia
    const trendData = getTrendData(metric, companyIdx, branchIdx);
    const trend = trendData[trendData.length - 1] - trendData[0];
    const trendColor = trend >= 0 ? 'rgba(29, 209, 161, 0.8)' : 'rgba(255, 107, 107, 0.8)';

    // Criar grÃ¡fico com Chart.js
    new Chart(canvas, {
        type: 'line',
        data: {
            labels: ['D-6', 'D-5', 'D-4', 'D-3', 'D-2', 'D-1', 'Hoje'],
            datasets: [{
                label: metric,
                data: trendData,
                borderColor: trendColor,
                backgroundColor: trendColor.replace('0.8', '0.1'),
                borderWidth: 2,
                fill: true,
                pointRadius: 0,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { display: false },
                x: { display: false }
            }
        }
    });
}
// Sistema de Alertas Preditivos Inteligentes
function getSmartAlerts() {
    const alerts = [];
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    companies.forEach((company, cIdx) => {
        company.branches.forEach((branch, bIdx) => {
            const branchDaily = branch.campaigns.reduce((s, c) => s + c.spend, 0);
            const branchRevenue = branch.sales.reduce((s, s2) => s + s2.totalLTV, 0);
            const branchROI = branchDaily > 0 ? Math.round(((branchRevenue - branchDaily) / branchDaily) * 100) : 0;

            // Alerta 1: ROI em queda acentuada (>20% em 24h)
            if (dailyHistory[yesterday] && dailyHistory[yesterday][`company_${cIdx}`]) {
                const yesterdayBranch = dailyHistory[yesterday][`company_${cIdx}`].branches[`branch_${bIdx}`];
                if (yesterdayBranch) {
                    const yesterdayRevenue = yesterdayBranch.revenue;
                    const yesterdaySpend = yesterdayBranch.spend;
                    const yesterdayROI = yesterdaySpend > 0 ? Math.round(((yesterdayRevenue - yesterdaySpend) / yesterdaySpend) * 100) : 0;
                    const roiDrop = yesterdayROI - branchROI;

                    if (roiDrop > 20) {
                        alerts.push({
                            id: `roi_drop_${cIdx}_${bIdx}`,
                            type: 'danger',
                            icon: 'ðŸ“‰',
                            title: 'ROI em Queda',
                            message: `${branch.name} teve queda de ${roiDrop}% no ROI em 24h`,
                            company: company.name,
                            branch: branch.name,
                            action: () => selectBranch(bIdx)
                        });
                    }
                }
            }

            // Alerta 2: Saldo crÃ­tico (vai acabar em menos de 48h)
            if (branchDaily > 0) {
                const daysUntilEmpty = Math.floor(branch.balance / branchDaily);
                if (daysUntilEmpty < 2 && daysUntilEmpty >= 0) {
                    alerts.push({
                        id: `balance_critical_${cIdx}_${bIdx}`,
                        type: 'warning',
                        icon: 'âš ï¸',
                        title: 'Saldo CrÃ­tico',
                        message: `${branch.name} vai ficar sem saldo em ${daysUntilEmpty} dia(s)`,
                        company: company.name,
                        branch: branch.name,
                        action: () => selectBranch(bIdx)
                    });
                }
            }

            // Alerta 3: Sem vendas por 7 dias
            const recentSales = branch.sales.filter(s => {
                const saleDate = new Date(s.date);
                const daysSince = Math.floor((Date.now() - saleDate) / 86400000);
                return daysSince <= 7;
            });

            if (recentSales.length === 0 && branch.campaigns.length > 0) {
                alerts.push({
                    id: `no_sales_${cIdx}_${bIdx}`,
                    type: 'info',
                    icon: 'ðŸ“­',
                    title: 'Sem Vendas Recentes',
                    message: `${branch.name} nÃ£o teve vendas nos Ãºltimos 7 dias`,
                    company: company.name,
                    branch: branch.name,
                    action: () => selectBranch(bIdx)
                });
            }
        });
    });

    return alerts;
}

// Renderizar alertas na interface
function displaySmartAlerts() {
    const alertsContainer = document.getElementById('smartAlertsContainer');
    if (!alertsContainer) return;

    const alerts = getSmartAlerts().filter(a => !dismissedAlerts.includes(a.id));

    if (alerts.length === 0) {
        alertsContainer.innerHTML = '';
        return;
    }

    alertsContainer.innerHTML = alerts.map(alert => `
        <div class="smart-alert alert-${alert.type}" style="display: flex; gap: 12px; padding: 16px; border-radius: 12px; margin-bottom: 12px; background: ${alert.type === 'danger' ? 'rgba(255, 107, 107, 0.1)' :
            alert.type === 'warning' ? 'rgba(255, 159, 67, 0.1)' :
                'rgba(0, 212, 255, 0.1)'
        }; border: 1px solid ${alert.type === 'danger' ? 'rgba(255, 107, 107, 0.3)' :
            alert.type === 'warning' ? 'rgba(255, 159, 67, 0.3)' :
                'rgba(0, 212, 255, 0.3)'
        }; border-left: 4px solid ${alert.type === 'danger' ? 'var(--danger)' :
            alert.type === 'warning' ? 'var(--warning)' :
                'var(--primary)'
        }; backdrop-filter: blur(10px); animation: slideInRight 0.3s ease;">
            <div style="font-size: 20px; flex-shrink: 0;">${alert.icon}</div>
            <div style="flex: 1;">
                <div style="font-weight: 700; color: var(--text-primary); font-size: 14px;">${alert.title}</div>
                <div style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">${alert.message}</div>
            </div>
            <button onclick="dismissAlert('${alert.id}')" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 16px; padding: 4px; transition: all 0.2s; flex-shrink: 0;" onmouseover="this.style.color='var(--text-primary)'" onmouseout="this.style.color='var(--text-secondary)'">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');
}

// MÃ¡scaras de Moeda e FormataÃ§Ã£o
function formatCurrencyInput(input) {
    let value = input.value.replace(/[^\d]/g, '');
    if (value) {
        value = (parseInt(value) / 100).toFixed(2);
        input.value = 'R$ ' + value.replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }
}

function getCurrencyValue(input) {
    return parseFloat(input.value.replace(/[^\d,]/g, '').replace(',', '.')) || 0;
}

// FunÃ§Ã£o para duplicar campanha
function duplicateCampaign(campaignIdx) {
    const branch = companies[currentCompanyIdx].branches[currentBranchIdx];
    const campaign = branch.campaigns[campaignIdx];

    if (!campaign) return;

    const newCampaign = {
        id: Date.now(),
        name: campaign.name + ' (CÃ³pia)',
        purpose: campaign.purpose,
        spend: campaign.spend,
        createdAt: new Date().toISOString()
    };

    branch.campaigns.push(newCampaign);
    save();
    showToast('success', 'Campanha Duplicada', 'Campanha ' + campaign.name + ' foi duplicada com sucesso!');
    renderBranch();
}

// Melhorar seletor de data com datepicker
function initDatePickers() {
    const dateInputs = document.querySelectorAll('input[type="date"]');
    dateInputs.forEach(input => {
        if (!input.classList.contains('date-picker-initialized')) {
            input.classList.add('date-picker-initialized');
            input.style.cursor = 'pointer';
        }
    });
}

// ValidaÃ§Ã£o em tempo real com feedback visual
function setupFormValidation() {
    const currencyInputs = document.querySelectorAll('[data-currency="true"]');
    currencyInputs.forEach(input => {
        input.addEventListener('blur', function () {
            formatCurrencyInput(this);
        });
        input.addEventListener('input', function () {
            if (this.value.length > 0 && !this.value.includes('R$')) {
                formatCurrencyInput(this);
            }
        });
    });
}

// FunÃ§Ã£o para adicionar botÃ£o de duplicaÃ§Ã£o nas campanhas
function addDuplicateButtonToCampaigns() {
    const campaignCards = document.querySelectorAll('[data-campaign-idx]');
    campaignCards.forEach(card => {
        const idx = card.getAttribute('data-campaign-idx');
        if (!card.querySelector('.btn-duplicate')) {
            const duplicateBtn = document.createElement('button');
            duplicateBtn.className = 'btn btn-icon btn-secondary btn-sm btn-duplicate';
            duplicateBtn.innerHTML = '<i class="fas fa-copy"></i>';
            duplicateBtn.title = 'Duplicar campanha';
            duplicateBtn.onclick = (e) => {
                e.stopPropagation();
                duplicateCampaign(parseInt(idx));
            };
            const actionContainer = card.querySelector('.campaign-actions');
            if (actionContainer) {
                actionContainer.appendChild(duplicateBtn);
            }
        }
    });
}


// CustomizaÃ§Ã£o de Dashboard
function toggleKPIVisibility(kpiName) {
    const idx = visibleKPIs.indexOf(kpiName);
    if (idx > -1) {
        visibleKPIs.splice(idx, 1);
    } else {
        visibleKPIs.push(kpiName);
    }
    localStorage.setItem('trafficflow_v8_visible_kpis', JSON.stringify(visibleKPIs));
    render();
}

function openDashboardCustomizer() {
    const allKPIs = ['balance', 'roi', 'spend', 'revenue', 'ticket', 'payback'];
    const kpiLabels = {
        'balance': 'Saldo Total',
        'roi': 'ROI',
        'spend': 'Gasto Diario',
        'revenue': 'Receita Total',
        'ticket': 'Ticket Medio',
        'payback': 'Payback'
    };

    const customizer = document.createElement('div');
    customizer.className = 'modal active';
    customizer.innerHTML = `
        <div class="modal-content" style="max-width: 400px;">
            <div class="modal-header">
                <div class="modal-title">Personalizar Dashboard</div>
                <button class="modal-close" onclick="this.closest('.modal').remove()"><i class="fas fa-times"></i></button>
            </div>
            <div style="padding: 20px; max-height: 400px; overflow-y: auto;">
                <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 16px;">Selecione quais metricas deseja exibir:</div>
                ${allKPIs.map(kpi => `
                    <label style="display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 6px; cursor: pointer; margin-bottom: 8px; transition: background 0.2s;">
                        <input type="checkbox" ${visibleKPIs.includes(kpi) ? 'checked' : ''} onchange="toggleKPIVisibility('${kpi}')">
                        <span>${kpiLabels[kpi]}</span>
                    </label>
                `).join('')}
            </div>
            <div style="display: flex; gap: 12px; padding: 16px; border-top: 1px solid var(--dark-border);">
                <button class="btn btn-primary" style="flex: 1;" onclick="this.closest('.modal').remove()">
                    <i class="fas fa-check"></i> Concluido
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(customizer);
}

// Navegacao Rapida
function initQuickSearch() {
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            openQuickSearch();
        }
    });
}

function openQuickSearch() {
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.style.background = 'rgba(0, 0, 0, 0.7)';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 500px; margin-top: 100px;">
            <div style="position: relative;">
                <i class="fas fa-search" style="position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: var(--text-secondary);"></i>
                <input type="text" id="quickSearchInput" placeholder="Buscar empresa, filial ou campanha..." 
                    style="width: 100%; padding: 14px 16px 14px 40px; border: none; border-radius: 8px 8px 0 0; background: var(--dark-surface); color: var(--text-primary); font-size: 16;" 
                    oninput="filterQuickSearch(this.value)">
            </div>
            <div id="quickSearchResults" style="max-height: 300px; overflow-y: auto; background: var(--dark-surface); border-radius: 0 0 8px 8px;"></div>
        </div>
    `;

    document.body.appendChild(modal);
    modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
    };

    document.getElementById('quickSearchInput').focus();
}

function filterQuickSearch(term) {
    const resultsContainer = document.getElementById('quickSearchResults');
    if (!term.trim()) {
        resultsContainer.innerHTML = '';
        return;
    }

    const results = [];
    companies.forEach((company, cIdx) => {
        if (company.name.toLowerCase().includes(term.toLowerCase())) {
            results.push({
                type: 'company',
                name: company.name,
                idx: cIdx
            });
        }

        company.branches.forEach((branch, bIdx) => {
            if (branch.name.toLowerCase().includes(term.toLowerCase())) {
                results.push({
                    type: 'branch',
                    name: branch.name,
                    parent: company.name,
                    companyIdx: cIdx,
                    branchIdx: bIdx
                });
            }
        });
    });

    resultsContainer.innerHTML = results.slice(0, 10).map((result, idx) => `
        <div onclick="navigateToResult('${result.type}', ${result.idx || result.companyIdx}, ${result.branchIdx || -1}); document.querySelector('.modal.active').remove();" 
            style="padding: 12px 16px; border-bottom: 1px solid var(--dark-border); cursor: pointer; transition: background 0.2s;" 
            onmouseover="this.style.background='rgba(0, 212, 255, 0.1)'" 
            onmouseout="this.style.background=''">
            <div style="font-weight: 500; color: var(--text-primary);">${result.name}</div>
            ${result.parent ? `<div style="font-size: 12px; color: var(--text-secondary);">${result.parent}</div>` : ''}
        </div>
    `).join('');
}

function navigateToResult(type, idx1, idx2) {
    if (type === 'company') {
        selectCompany(idx1);
    } else if (type === 'branch') {
        selectCompany(idx1);
        setTimeout(() => selectBranch(idx2), 100);
    }
}

// ============================================================
// NAVEGAÃ‡ÃƒO
// ============================================================
function goToHome() {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navHome = document.getElementById('navHome');
    if (navHome) navHome.classList.add('active');
    navigateWithTransition(() => {
        currentView = 'companies';
        currentCompanyIdx = null;
        currentBranchIdx = null;
        branchSearchTerm = '';
        branchSortOrder = 'name-asc';
        updateBreadcrumb();
        renderCompanies();
        document.querySelectorAll('.nav-item').forEach((el, i) => el.classList.toggle('active', i === 0));
    });
}

function selectCompany(idx) {
    navigateWithTransition(() => {
        currentCompanyIdx = idx;
        currentView = 'company';
        branchSearchTerm = '';
        branchSortOrder = 'name-asc';
        updateBreadcrumb();
        renderCompany();
    });
}

// FunÃ§Ã£o para ativar efeito de transiÃ§Ã£o de pÃ¡gina
function activatePageTransition() {
    const main = document.querySelector('.main');
    if (main) {
        main.classList.add('page-transition-blur');
    }
}

// FunÃ§Ã£o de transiÃ§Ã£o de pÃ¡gina com blur
function navigateWithTransition(callback) {
    const main = document.querySelector('.main');
    if (main) {
        main.classList.add('page-transition-blur');
        setTimeout(() => {
            callback();
            main.classList.remove('page-transition-blur');
            main.classList.add('page-enter');
            setTimeout(() => {
                main.classList.remove('page-enter');
            }, 500);
        }, 500);
    } else {
        callback();
    }
}

function selectBranch(branchIdx) {
    navigateWithTransition(() => {
        currentBranchIdx = branchIdx;
        currentView = 'branch';
        updateBreadcrumb();
        renderBranch();
    });
}

function updateBreadcrumb() {
    const breadcrumb = document.getElementById('breadcrumb');
    let html = '<span class="breadcrumb-item" onclick="goToHome()" tabindex="0" role="link" aria-label="Ir para Empresas">Empresas</span>';
    if (currentCompanyIdx !== null) {
        html += '<span style="color:var(--text-tertiary);margin:0 4px;">/</span>';
        html += `<span class="breadcrumb-item" onclick="selectCompany(${currentCompanyIdx})" tabindex="0" role="link">${companies[currentCompanyIdx].name}</span>`;
    }
    if (currentBranchIdx !== null && currentCompanyIdx !== null) {
        html += '<span style="color:var(--text-tertiary);margin:0 4px;">/</span>';
        html += `<span class="breadcrumb-item" style="color:var(--text-secondary);cursor:default;">${companies[currentCompanyIdx].branches[currentBranchIdx].name}</span>`;
    }
    breadcrumb.innerHTML = html;
}

// ============================================================
// RENDER COMPANIES
// ============================================================
function renderCompanies() {
    const content = document.getElementById('content');
    document.getElementById('pageTitle').textContent = 'Empresas';
    document.getElementById('mainBtnText').textContent = 'Nova Empresa';
    document.getElementById('mainBtn').onclick = () => showAddModal();

    if (companies.length === 0) {
        content.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i class="fas fa-building"></i></div>
                <div class="empty-state-title">Nenhuma empresa cadastrada</div>
                <div class="empty-state-text">Comece criando sua primeira empresa para gerenciar campanhas e ROI.</div>
                <button class="btn btn-primary" onclick="showAddModal()">
                    <i class="fas fa-plus"></i> Criar Primeira Empresa
                </button>
            </div>`;
        return;
    }

    let html = '<div class="grid">';
    companies.forEach((company, idx) => {
        const totalBalance = company.branches.reduce((s, b) => s + b.balance, 0);
        const totalDaily = company.branches.reduce((s, b) => s + b.campaigns.reduce((ss, c) => ss + c.spend, 0), 0);
        const totalRevenue = company.branches.reduce((s, b) => s + b.sales.reduce((ss, sale) => ss + (sale.totalLTV || 0), 0), 0);
        const roi = totalDaily > 0 ? Math.round(((totalRevenue - totalDaily) / totalDaily) * 100) : 0;
        const health = getHealthStatus(totalBalance, totalDaily);

        // Company logo or initials
        const companyInitial = company.name.charAt(0).toUpperCase();
        const hasLogo = company.logo && company.logo.length > 0;
        const logoHtml = hasLogo
            ? `<img src="${company.logo}" style="width:100%;height:100%;object-fit:contain;" alt="${company.name}">`
            : `<span style="font-size:20px;font-weight:700;color:var(--primary);">${companyInitial}</span>`;

        html += `
            <div class="card" onclick="selectCompany(${idx})" style="border-color: ${health.color};" tabindex="0" role="button" aria-label="Abrir empresa ${company.name}" onkeydown="if(event.key==='Enter')selectCompany(${idx})">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
                    <div style="display:flex;align-items:center;gap:12px;">
                        <div style="width:48px;height:48px;border-radius:12px;background:var(--surface);border:2px solid var(--primary);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;">
                            ${logoHtml}
                        </div>
                        <div>
                            <div class="card-title">${company.name}</div>
                            <div class="health-indicator ${health.pulse ? 'pulse' : ''}" style="background:${health.color};box-shadow:0 0 8px ${health.color};display:inline-block;margin-top:4px;" title="${health.label}"></div>
                        </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <button class="btn btn-icon btn-secondary btn-sm" onclick="event.stopPropagation();showEditCompanyModal(${idx})" aria-label="Editar empresa" data-tooltip="Editar">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-icon btn-danger btn-sm" onclick="event.stopPropagation();deleteCompany(${idx})" aria-label="Deletar empresa" data-tooltip="Deletar">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="card-value">${formatCurrency(totalBalance)}</div>
                <div class="card-subtitle">${health.label} Â· ${health.days === Infinity ? 'âˆž' : health.days} dias</div>
                <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
                    <div>
                        <div style="font-size:11px;color:var(--text-secondary);">Filiais</div>
                        <div style="font-size:14px;font-weight:700;color:var(--primary);">${company.branches.length}</div>
                    </div>
                    <div>
                        <div style="font-size:11px;color:var(--text-secondary);">ROI</div>
                        <div style="font-size:14px;font-weight:700;color:${roi >= 0 ? 'var(--secondary)' : 'var(--danger)'};">${roi}%</div>
                    </div>
                    <div>
                        <div style="font-size:11px;color:var(--text-secondary);">Budget</div>
                        <div style="font-size:14px;font-weight:700;color:var(--text-primary);">${formatCurrency(company.monthlyBudget || 0)}</div>
                    </div>
                </div>
            </div>`;
    });
    html += '</div>';
    content.innerHTML = html;

    // Renderizar grÃ¡ficos apÃ³s inserir no DOM
    kpiOrder.forEach(key => {
        if (['balance', 'spend', 'revenue'].includes(key)) {
            renderTrendChart(key, currentCompanyIdx, currentBranchIdx, `chart-container-branch-${key}`);
        }
    });
}

// ============================================================
// Filtrar e ordenar filiais
function getFilteredAndSortedBranches() {
    const company = companies[currentCompanyIdx];
    let filtered = company.branches.filter(branch =>
        branch.name.toLowerCase().includes(branchSearchTerm.toLowerCase())
    );

    filtered.sort((a, b) => {
        switch (branchSortOrder) {
            case 'name-asc':
                return a.name.localeCompare(b.name);
            case 'name-desc':
                return b.name.localeCompare(a.name);
            case 'balance-asc':
                return a.balance - b.balance;
            case 'balance-desc':
                return b.balance - a.balance;
            default:
                return 0;
        }
    });

    return filtered;
}

function setBranchSearch(term) {
    branchSearchTerm = term;
    renderCompany();
    const input = document.getElementById('branchSearchInput');
    if (input) {
        input.focus();
        input.setSelectionRange(term.length, term.length);
    }
}

function setBranchSort(order) {
    branchSortOrder = order;
    renderCompany();
}

// RENDER COMPANY
// ============================================================
function renderCompany() {
    const content = document.getElementById('content');
    const company = companies[currentCompanyIdx];
    document.getElementById('pageTitle').textContent = company.name;
    document.getElementById('mainBtnText').textContent = 'Nova Filial';
    document.getElementById('mainBtn').onclick = () => showAddModal();

    const totalBalance = company.branches.reduce((s, b) => s + b.balance, 0);
    const totalDaily = company.branches.reduce((s, b) => s + b.campaigns.reduce((ss, c) => ss + c.spend, 0), 0);
    const totalRevenue = company.branches.reduce((s, b) => s + b.sales.reduce((ss, sale) => ss + (sale.totalLTV || 0), 0), 0);
    const roi = totalDaily > 0 ? Math.round(((totalRevenue - totalDaily) / totalDaily) * 100) : 0;

    let html = `
        <div style="display: flex; justify-content: flex-end; margin-bottom: 12px;">
            <button class="btn btn-sm btn-secondary" onclick="openDashboardCustomizer()">
                <i class="fas fa-cog"></i> Personalizar Dashboard
            </button>
        </div>
        <div class="grid">
            ${visibleKPIs.includes('balance') ? `
            <div class="card" id="kpi-balance">
                <div class="card-title">Saldo Total</div>
                <div class="card-value">${formatCurrency(totalBalance)}</div>
                <div id="chart-container-balance" style="height: 50px;"></div>
            </div>` : ''}
            ${visibleKPIs.includes('spend') ? `
            <div class="card" id="kpi-spend">
                <div class="card-title">Gasto DiÃ¡rio</div>
                <div class="card-value">${formatCurrency(totalDaily)}</div>
                <div id="chart-container-spend" style="height: 50px;"></div>
            </div>` : ''}
            ${visibleKPIs.includes('revenue') ? `
            <div class="card" id="kpi-revenue">
                <div class="card-title">Receita Total</div>
                <div class="card-value">${formatCurrency(totalRevenue)}</div>
                <div id="chart-container-revenue" style="height: 50px;"></div>
            </div>` : ''}
            ${visibleKPIs.includes('roi') ? `
            <div class="card" id="kpi-roi">
                <div class="card-title">ROI Consolidado</div>
                <div class="card-value" style="color:${roi >= 0 ? 'var(--secondary)' : 'var(--danger)'};">${roi}%</div>
                <div id="chart-container-roi" style="height: 50px;"></div>
            </div>` : ''}
        </div>
        <div class="section-title">
            Filiais
            <div style="display:flex;gap:8px;">
                <button class="btn btn-sm btn-secondary" onclick="openBudgetModal()">
                    <i class="fas fa-wallet"></i> OrÃ§amentos
                </button>
            </div>
        </div>`;

    html += `
        <div style="display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; align-items: center;">
            <div style="flex: 1; min-width: 250px; position: relative;">
                <i class="fas fa-search" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-secondary);"></i>
                <input type="text" id="branchSearchInput" placeholder="Pesquisar filiais..." 
                    style="width: 100%; padding: 10px 12px 10px 36px; border: 1px solid var(--dark-border); border-radius: 8px; background: var(--dark-surface); color: var(--text-primary); font-size: 14px;"
                    oninput="setBranchSearch(this.value)" value="${branchSearchTerm}">
            </div>
            <select id="branchSortSelect" onchange="setBranchSort(this.value)" 
                style="padding: 10px 12px; border: 1px solid var(--dark-border); border-radius: 8px; background: var(--dark-surface); color: var(--text-primary); font-size: 14px; cursor: pointer;">
                <option value="name-asc" ${branchSortOrder === 'name-asc' ? 'selected' : ''}>A - Z</option>
                <option value="name-desc" ${branchSortOrder === 'name-desc' ? 'selected' : ''}>Z - A</option>
                <option value="balance-asc" ${branchSortOrder === 'balance-asc' ? 'selected' : ''}>Saldo: Menor para Maior</option>
                <option value="balance-desc" ${branchSortOrder === 'balance-desc' ? 'selected' : ''}>Saldo: Maior para Menor</option>
            </select>
        </div>
    `;

    if (company.branches.length === 0) {
        html += '<p style="text-align:center;padding:40px;color:var(--text-secondary);">Nenhuma filial cadastrada. Clique em "Nova Filial" para comeÃ§ar.</p>';
    } else {
        const filteredBranches = getFilteredAndSortedBranches();
        if (filteredBranches.length === 0) {
            html += '<p style="text-align:center;padding:40px;color:var(--text-secondary);">Nenhuma filial encontrada com os filtros aplicados.</p>';
        } else {
            html += '<div class="grid">';
            filteredBranches.forEach((branch) => {
                const idx = company.branches.indexOf(branch);
                const branchDaily = branch.campaigns.reduce((s, c) => s + c.spend, 0);
                const branchRevenue = branch.sales.reduce((s, s2) => s + s2.totalLTV, 0);
                const branchROI = branchDaily > 0 ? Math.round(((branchRevenue - branchDaily) / branchDaily) * 100) : 0;
                const health = getHealthStatus(branch.balance, branchDaily);
                const budget = branch.budget || 0;
                const budgetPct = budget > 0 ? Math.min(100, Math.round((branchDaily / budget) * 100)) : 0;

                html += `
                <div class="card health-${health.status}" onclick="selectBranch(${idx})" tabindex="0" role="button" aria-label="Abrir filial ${branch.name}" onkeydown="if(event.key==='Enter')selectBranch(${idx})">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                        <div class="card-title">${branch.name}</div>
                        <div style="display:flex;align-items:center;gap:6px;">
                            <div class="health-indicator ${health.pulse ? 'pulse' : ''}" style="background:${health.color};box-shadow:0 0 8px ${health.color};"></div>
                            <button class="btn btn-icon btn-secondary btn-sm" onclick="event.stopPropagation();showEditBranchModal(${idx})" aria-label="Editar filial" data-tooltip="Editar">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn btn-icon btn-danger btn-sm" onclick="event.stopPropagation();deleteBranchByIdx(${idx})" aria-label="Deletar filial" data-tooltip="Deletar">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                    <div class="card-value">${formatCurrency(branch.balance)}</div>
                    <div class="card-subtitle">${health.label} Â· ${health.days === Infinity ? 'âˆž' : health.days} dias</div>
                    ${budget > 0 ? `
                    <div style="margin-top:10px;">
                        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-secondary);margin-bottom:4px;">
                            <span>OrÃ§amento</span>
                            <span style="color:${budgetPct >= alertSettings.budgetThreshold ? 'var(--danger)' : 'var(--secondary)'};">${budgetPct}%</span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width:${budgetPct}%;background:${budgetPct >= alertSettings.budgetThreshold ? 'var(--danger)' : 'var(--secondary)'};"></div>
                        </div>
                    </div>` : ''}
                    <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--dark-border);display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                        <div>
                            <div style="font-size:11px;color:var(--text-secondary);">Campanhas</div>
                            <div style="font-size:14px;font-weight:700;color:var(--primary);">${branch.campaigns.length}</div>
                        </div>
                        <div>
                            <div style="font-size:11px;color:var(--text-secondary);">ROI</div>
                            <div style="font-size:14px;font-weight:700;color:${branchROI >= 0 ? 'var(--secondary)' : 'var(--danger)'};">${branchROI}%</div>
                        </div>
                    </div>
                <!-- Hover Actions -->
                <div class="card-hover-actions">
                    <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();currentBranchIdx=idx;showSaleModal()">
                        <i class="fas fa-plus"></i> Registrar Venda
                    </button>
                    <button class="btn btn-warning btn-sm" onclick="event.stopPropagation();dismissBranchAlerts(${idx})">
                        <i class="fas fa-bell-slash"></i> Pausar Alerta
                    </button>
                </div>
                </div>`;
            });
            html += '</div>';
        }
    }

    html += `
        <div style="margin-top:24px;display:flex;gap:10px;flex-wrap:wrap;">
            <button class="btn btn-primary" onclick="openPremiumReport()">
                <i class="fas fa-chart-bar"></i> RelatÃ³rio Premium
            </button>
            <button class="btn btn-secondary" onclick="showReportModal('company')">
                <i class="fas fa-file-alt"></i> Gerar RelatÃ³rio HTML
            </button>
            <button class="btn btn-share" onclick="openModal('shareModal')">
                <i class="fas fa-share-alt"></i> Compartilhar
            </button>
            <button class="btn btn-danger" onclick="deleteCompanyConfirm(${currentCompanyIdx})">
                <i class="fas fa-trash"></i> Deletar Empresa
            </button>
        </div>`;

    content.innerHTML = html;

    // Renderizar grÃ¡ficos apÃ³s inserir no DOM
    if (visibleKPIs.includes('balance')) renderTrendChart('balance', currentCompanyIdx, null, 'chart-container-balance');
    if (visibleKPIs.includes('spend')) renderTrendChart('spend', currentCompanyIdx, null, 'chart-container-spend');
    if (visibleKPIs.includes('revenue')) renderTrendChart('revenue', currentCompanyIdx, null, 'chart-container-revenue');
}

// ============================================================
// RENDER BRANCH
// ============================================================
function renderBranch() {
    const content = document.getElementById('content');
    const company = companies[currentCompanyIdx];
    const branch = company.branches[currentBranchIdx];
    document.getElementById('pageTitle').textContent = branch.name;
    document.getElementById('mainBtnText').textContent = 'Nova Venda';
    document.getElementById('mainBtn').onclick = () => showSaleModal();

    const branchDaily = branch.campaigns.reduce((s, c) => s + c.spend, 0);
    const branchRevenue = branch.sales.reduce((s, sale) => s + sale.totalLTV, 0);
    const health = getHealthStatus(branch.balance, branchDaily);
    const kpis = calculateAdvancedKPIs(branch);

    const kpiDefs = {
        balance: {
            label: 'Saldo DisponÃ­vel',
            value: formatCurrency(branch.balance),
            trend: `${health.label} Â· ${health.days === Infinity ? 'âˆž' : health.days} dias`,
            yesterdayInfo: `Ontem: ${formatCurrency(getYesterdayBalance(currentCompanyIdx, currentBranchIdx))}`,
            trendClass: health.days > alertSettings.balanceDays ? 'positive' : 'negative',
            icon: health.days > alertSettings.balanceDays ? 'arrow-up' : 'arrow-down',
            statusClass: health.days < 3 ? 'critical' : health.days < 7 ? 'warning' : 'success'
        },
        roi: {
            label: 'ROI Total',
            value: `${kpis.roi}%`,
            trend: kpis.roi > 0 ? 'Lucrativo' : 'PrejuÃ­zo',
            trendClass: kpis.roi > 0 ? 'positive' : 'negative',
            icon: kpis.roi > 0 ? 'arrow-up' : 'arrow-down',
            statusClass: kpis.roi > 0 ? 'success' : 'critical',
            valueStyle: `color:${kpis.roi > 0 ? 'var(--secondary)' : 'var(--danger)'};`
        },
        spend: {
            label: 'Gasto Total',
            value: formatCurrency(kpis.totalSpend),
            trend: `${branch.campaigns.length} campanhas`,
            trendClass: '',
            icon: 'chart-line'
        },
        revenue: {
            label: 'Receita Total',
            value: formatCurrency(kpis.totalRevenue),
            trend: `${branch.sales.length} vendas`,
            trendClass: 'positive',
            icon: 'arrow-up'
        },
        ticket: {
            label: 'Ticket MÃ©dio',
            value: formatCurrency(kpis.avgTicket),
            trend: 'Por cliente',
            trendClass: '',
            icon: 'user'
        },
        payback: {
            label: 'Payback',
            value: `${kpis.payback}%`,
            trend: 'Tempo de retorno',
            trendClass: '',
            icon: 'hourglass-half'
        }
    };

    let html = '<div class="kpi-advanced">';
    kpiOrder.forEach(key => {
        const k = kpiDefs[key];
        if (!k) return;
        html += `
            <div class="kpi-card-advanced ${k.statusClass || ''}" draggable="true" data-kpi="${key}"
                 ondragstart="onKpiDragStart(event)" ondragover="onKpiDragOver(event)" ondrop="onKpiDrop(event)" ondragleave="onKpiDragLeave(event)">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                    <div class="kpi-label-advanced">${k.label}</div>
                    <i class="fas fa-grip-vertical kpi-drag-handle" aria-hidden="true" title="Arrastar para reordenar"></i>
                </div>
                <div class="kpi-value-advanced" style="${k.valueStyle || ''}">${k.value}</div>
                <div class="kpi-trend ${k.trendClass || ''}">
                    <i class="fas fa-${k.icon}"></i> ${k.trend}
                </div>
                ${k.yesterdayInfo ? `<div style="font-size: 10px; color: var(--text-tertiary); margin-top: 4px;">${k.yesterdayInfo}</div>` : ''}
                <div id="chart-container-branch-${key}" style="height: 40px; margin-top: 8px;"></div>
            </div>`;
    });
    html += '</div>';


    // Card de Recarga RÃ¡pida
    html += `
        <div class="card" style="margin-bottom: 20px; border-left: 4px solid var(--secondary); background: rgba(29, 209, 161, 0.05);">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap;">
                <div>
                    <div style="font-size: 14px; font-weight: 700; color: var(--text-primary);">âš¡ Recarga RÃ¡pida de Saldo</div>
                    <div style="font-size: 12px; color: var(--text-secondary);">Adicione saldo instantaneamente a esta filial.</div>
                </div>
                <div style="display: flex; gap: 8px; align-items: center; flex: 1; min-width: 200px;">
                    <input type="text" class="form-input" id="quickBalanceInput" placeholder="R$ 0,00" data-currency="true" style="max-width: 150px;">
                    <button class="btn btn-success" onclick="quickAddBalance()" style="white-space: nowrap;">
                        <i class="fas fa-plus"></i> Adicionar Saldo
                    </button>
                </div>
            </div>
        </div>`;

    // Grupos de campanhas
    const groups = branch.campaignGroups || [];
    const ungrouped = branch.campaigns.filter(c => !c.groupId);
    const grouped = groups.map(g => ({ ...g, campaigns: branch.campaigns.filter(c => c.groupId === g.id) }));

    html += `
        <div class="section-title">
            Campanhas
            <div style="display:flex;gap:8px;">
                <button class="btn btn-sm btn-secondary" onclick="showCampaignGroupModal()">
                    <i class="fas fa-layer-group"></i> Novo Grupo
                </button>
                <button class="btn btn-sm btn-primary" onclick="showCampaignModal()">
                    <i class="fas fa-plus"></i> Nova Campanha
                </button>
            </div>
        </div>`;

    if (branch.campaigns.length === 0) {
        html += '<p style="text-align:center;padding:30px;color:var(--text-secondary);">Nenhuma campanha ativa. Adicione campanhas para calcular ROI.</p>';
    } else {
        // Grupos
        grouped.forEach(group => {
            if (group.campaigns.length === 0) return;
            const groupSpend = group.campaigns.reduce((s, c) => s + c.spend, 0);
            html += `
                <div class="campaign-group">
                    <div class="campaign-group-header" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'grid' : 'none'">
                        <div class="campaign-group-title">
                            <i class="fas fa-layer-group"></i>
                            ${group.name}
                            <span class="badge badge-primary">${group.campaigns.length}</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:10px;">
                            <span style="font-size:12px;color:var(--text-secondary);">${formatCurrency(groupSpend)}/dia</span>
                            <button class="btn btn-icon btn-danger btn-sm" onclick="event.stopPropagation();deleteCampaignGroup('${group.id}')" aria-label="Deletar grupo">
                                <i class="fas fa-trash"></i>
                            </button>
                            <i class="fas fa-chevron-down" style="color:var(--text-tertiary);font-size:12px;"></i>
                        </div>
                    </div>
                    <div class="campaign-group-body">
                        ${group.campaigns.map((campaign, idx) => renderCampaignCard(campaign, branch.campaigns.indexOf(campaign))).join('')}
                    </div>
                </div>`;
        });

        // Sem grupo
        if (ungrouped.length > 0) {
            html += '<div class="grid">';
            ungrouped.forEach(campaign => {
                html += renderCampaignCard(campaign, branch.campaigns.indexOf(campaign));
            });
            html += '</div>';
        }
    }

    // Vendas
    html += `
        <div class="section-title" style="margin-top:10px;">
            Vendas Registradas
            <div style="display:flex;gap:8px;">
                <button class="btn btn-sm btn-secondary" onclick="openRoiForecastModal()">
                    <i class="fas fa-chart-line"></i> PrevisÃ£o ROI
                </button>
            </div>
        </div>
        <div class="filters" role="group" aria-label="Filtrar por perÃ­odo">
            <button class="filter-btn ${filterPeriod === 'all' ? 'active' : ''}" onclick="setFilterPeriod('all')" aria-pressed="${filterPeriod === 'all'}">Todas</button>
            <button class="filter-btn ${filterPeriod === '7' ? 'active' : ''}" onclick="setFilterPeriod('7')" aria-pressed="${filterPeriod === '7'}">Ãšltimos 7 dias</button>
            <button class="filter-btn ${filterPeriod === '30' ? 'active' : ''}" onclick="setFilterPeriod('30')" aria-pressed="${filterPeriod === '30'}">Ãšltimos 30 dias</button>
            <button class="filter-btn ${filterPeriod === '90' ? 'active' : ''}" onclick="setFilterPeriod('90')" aria-pressed="${filterPeriod === '90'}">Ãšltimos 90 dias</button>
        </div>`;

    const filteredSales = filterSalesByPeriod(branch.sales);

    if (filteredSales.length === 0) {
        html += '<p style="text-align:center;padding:30px;color:var(--text-secondary);">Nenhuma venda no perÃ­odo selecionado.</p>';
    } else {
        const channelLabels = { google_ads: 'Google Ads', meta_ads: 'Meta Ads', tiktok_ads: 'TikTok Ads', organico: 'OrgÃ¢nico', indicacao: 'IndicaÃ§Ã£o', outro: 'Outro', '': 'â€”' };
        html += `
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:12px;" class="export-group">
                <button class="btn btn-sm btn-secondary" onclick="exportSalesCSV()"><i class="fas fa-file-csv"></i> CSV</button>
                <button class="btn btn-sm btn-warning" onclick="exportSalesExcel()"><i class="fas fa-file-excel"></i> Excel</button>
            </div>
            <div class="table-container">
                <table role="table" aria-label="Tabela de vendas">
                    <thead>
                        <tr>
                            <th onclick="sortSales('clientName')">Cliente <span class="sort-icon"><i class="fas fa-sort"></i></span></th>
                            <th onclick="sortSales('date')">Data <span class="sort-icon"><i class="fas fa-sort"></i></span></th>
                            <th>Produto</th>
                            <th>Canal</th>
                            <th onclick="sortSales('saleValue')">Valor <span class="sort-icon"><i class="fas fa-sort"></i></span></th>
                            <th>AdesÃ£o</th>
                            <th>ComissÃ£o</th>
                            <th>Parcelamento</th>
                            <th onclick="sortSales('totalLTV')">LTV <span class="sort-icon"><i class="fas fa-sort"></i></span></th>
                            <th onclick="sortSales('roi')">ROI <span class="sort-icon"><i class="fas fa-sort"></i></span></th>
                            <th>AÃ§Ãµes</th>
                        </tr>
                    </thead>
                    <tbody>`;

        filteredSales.forEach((sale, idx) => {
            const saleDate = new Date(sale.date + 'T00:00:00').toLocaleDateString('pt-BR');
            const parcelamento = sale.hasInstallment ? `${sale.installments}x de ${formatCurrency(sale.installmentValue)}` : 'â€”';
            const roiValue = sale.roi || 0;
            const originalIdx = branch.sales.indexOf(sale);

            html += `
                <tr>
                    <td><strong>${sale.clientName}</strong></td>
                    <td>${saleDate}</td>
                    <td>${sale.product || 'â€”'}</td>
                    <td><span class="badge badge-primary">${channelLabels[sale.channel || ''] || 'â€”'}</span></td>
                    <td><strong>${formatCurrency(sale.saleValue || 0)}</strong></td>
                    <td>${formatCurrency(sale.adhesionValue || 0)}</td>
                    <td><span class="text-success fw-bold">${formatCurrency(sale.commissionValue || 0)}</span></td>
                    <td>${parcelamento}</td>
                    <td>${formatCurrency(sale.totalLTV)}</td>
                    <td><span class="${roiValue >= 0 ? 'text-success' : 'text-danger'} fw-bold">${roiValue}%</span></td>
                    <td>
                        <div style="display:flex;gap:4px;">
                            <button class="btn btn-icon btn-secondary btn-sm" onclick="editSale(${originalIdx})" aria-label="Editar venda" data-tooltip="Editar">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn btn-icon btn-danger btn-sm" onclick="deleteSale(${originalIdx})" aria-label="Deletar venda" data-tooltip="Deletar">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>`;
        });

        html += `
                    </tbody>
                </table>
            </div>`;
    }

    html += `
        <div style="margin-top:24px;display:flex;gap:10px;flex-wrap:wrap;">
            <button class="btn btn-primary" onclick="openPremiumReport()">
                <i class="fas fa-chart-bar"></i> RelatÃ³rio Premium
            </button>
            <button class="btn btn-secondary" onclick="showReportModal('branch')">
                <i class="fas fa-file-alt"></i> Gerar RelatÃ³rio HTML
            </button>
            <button class="btn btn-share" onclick="openModal('shareModal')">
                <i class="fas fa-share-alt"></i> Compartilhar
            </button>
            <button class="btn btn-warning" onclick="openBudgetModal()">
                <i class="fas fa-wallet"></i> OrÃ§amento
            </button>
            <button class="btn btn-danger" onclick="deleteBranchConfirm()">
                <i class="fas fa-trash"></i> Deletar Filial
            </button>
        </div>`;

    content.innerHTML = html;
    displayAlerts();
    displayInsights();
    updateNotifications();
}

function renderCampaignCard(campaign, idx) {
    const icons = { vendas: 'ðŸ’°', leads: 'ðŸ“ž', marca: 'ðŸŽ¯' };
    return `
        <div class="card" style="cursor:default;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
                <div>
                    <div class="card-title">${icons[campaign.purpose] || 'ðŸ“Œ'} ${campaign.purpose.toUpperCase()}</div>
                    <div style="font-size:15px;font-weight:600;color:var(--text-primary);">${campaign.name}</div>
                    ${campaign.groupId ? `<span class="badge badge-purple" style="margin-top:4px;">${getCampaignGroupName(campaign.groupId)}</span>` : ''}
                </div>
                <div style="display:flex;gap:4px;">
                    <button class="btn btn-icon btn-secondary btn-sm" onclick="editCampaign(${idx})" aria-label="Editar campanha" data-tooltip="Editar">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-icon btn-secondary btn-sm" onclick="duplicateCampaign(${idx})" aria-label="Duplicar campanha" data-tooltip="Duplicar">
                        <i class="fas fa-copy"></i>
                    </button>
                    <button class="btn btn-icon btn-danger btn-sm" onclick="deleteCampaign(${idx})" aria-label="Deletar campanha" data-tooltip="Deletar">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="card-value">${formatCurrency(campaign.spend)}</div>
            <div class="card-subtitle">Gasto DiÃ¡rio</div>
        </div>`;
}

function getCampaignGroupName(groupId) {
    if (currentBranchIdx === null) return '';
    const groups = companies[currentCompanyIdx].branches[currentBranchIdx].campaignGroups || [];
    const g = groups.find(g => g.id === groupId);
    return g ? g.name : '';
}

// ============================================================
// DRAG & DROP KPI ORDER
// ============================================================
let draggedKpi = null;

function onKpiDragStart(e) {
    draggedKpi = e.currentTarget.dataset.kpi;
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function onKpiDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('drag-over');
}

function onKpiDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

function onKpiDrop(e) {
    e.preventDefault();
    const target = e.currentTarget.dataset.kpi;
    e.currentTarget.classList.remove('drag-over');
    if (draggedKpi && target && draggedKpi !== target) {
        const fromIdx = kpiOrder.indexOf(draggedKpi);
        const toIdx = kpiOrder.indexOf(target);
        if (fromIdx !== -1 && toIdx !== -1) {
            kpiOrder.splice(fromIdx, 1);
            kpiOrder.splice(toIdx, 0, draggedKpi);
            localStorage.setItem('trafficflow_v8_kpiOrder', JSON.stringify(kpiOrder));
            renderBranch();
            showToast('info', 'Dashboard atualizado', 'Ordem dos KPIs salva.');
        }
    }
    draggedKpi = null;
}

// ============================================================
// FILTROS E SORT
// ============================================================
function setFilterPeriod(period) {
    filterPeriod = period;
    localStorage.setItem('trafficflow_v8_filterPeriod', period);
    renderBranch();
}

function filterSalesByPeriod(sales) {
    if (filterPeriod === 'all') return sales;
    const days = parseInt(filterPeriod);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return sales.filter(s => new Date(s.date + 'T00:00:00') >= cutoff);
}

let sortField = null;
let sortAsc = true;

function sortSales(field) {
    const branch = companies[currentCompanyIdx].branches[currentBranchIdx];
    if (sortField === field) {
        sortAsc = !sortAsc;
    } else {
        sortField = field;
        sortAsc = true;
    }
    branch.sales.sort((a, b) => {
        let va = a[field], vb = b[field];
        if (typeof va === 'string') va = va.toLowerCase();
        if (typeof vb === 'string') vb = vb.toLowerCase();
        if (va < vb) return sortAsc ? -1 : 1;
        if (va > vb) return sortAsc ? 1 : -1;
        return 0;
    });
    renderBranch();
}

// ============================================================
// MODAIS - ABRIR/FECHAR
// ============================================================
function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.add('active');
        const firstFocusable = modal.querySelector('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (firstFocusable) setTimeout(() => firstFocusable.focus(), 100);
    }
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('active');
}

// Fechar modal ao clicar fora (apenas se clicar diretamente no modal, nÃ£o nos filhos)
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal') && e.target === e.currentTarget) {
        e.target.classList.remove('active');
    }
});

// Fechar modal com ESC
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
        document.querySelectorAll('.dropdown-menu.open').forEach(d => d.classList.remove('open'));
    }
});

// ============================================================
// LOGO UPLOAD HANDLING
// ============================================================
let currentLogoData = null;

function handleLogoUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file size (max 200KB)
    if (file.size > 200 * 1024) {
        showToast('error', 'Arquivo muito grande', 'O logo deve ter no mÃ¡ximo 200KB.');
        return;
    }

    // Validate file type
    if (!file.type.match(/image\/(png|jpg|jpeg|svg\+xml|webp)/)) {
        showToast('error', 'Tipo invÃ¡lido', 'Use PNG, JPG, SVG ou WebP.');
        return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
            // Resize if needed (max 200px)
            let canvas = document.createElement('canvas');
            let ctx = canvas.getContext('2d');
            let maxSize = 200;

            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > maxSize) {
                    height *= maxSize / width;
                    width = maxSize;
                }
            } else {
                if (height > maxSize) {
                    width *= maxSize / height;
                    height = maxSize;
                }
            }

            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);

            currentLogoData = canvas.toDataURL('image/png');
            document.getElementById('logoPreview').innerHTML = `<img src="${currentLogoData}" style="width: 100%; height: 100%; object-fit: contain;">`;
            showToast('success', 'Logo carregado', 'PrÃ©-visualizaÃ§Ã£o atualizada.');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function resetLogoUpload() {
    currentLogoData = null;
    document.getElementById('logoPreview').innerHTML = `<i class="fas fa-image" style="color: var(--text-tertiary); font-size: 20px;"></i>`;
    document.getElementById('companyLogoInput').value = '';
}

// ============================================================
// SHOW ADD MODAL (Empresa / Filial)
// ============================================================
function showAddModal() {
    editingItem = null;
    document.getElementById('addSubmitText').textContent = 'Criar';
    document.getElementById('field1Input').value = '';
    document.getElementById('field2Input').value = '';
    document.getElementById('field1Input').className = 'form-input';
    document.getElementById('field1Icon').innerHTML = '';
    document.getElementById('field1Error').classList.add('hidden');

    if (currentView === 'companies') {
        document.getElementById('modalTitle').textContent = 'Nova Empresa';
        document.getElementById('field1Label').textContent = 'Nome da Empresa';
        document.getElementById('field1Input').placeholder = 'Ex: Rede de Academias X';
        document.getElementById('field2Label').textContent = 'Budget Mensal (R$)';
        document.getElementById('field2Input').placeholder = '10000';
        document.getElementById('logoGroup').style.display = 'block';
        resetLogoUpload();
    } else if (currentView === 'company') {
        document.getElementById('logoGroup').style.display = 'none';
        document.getElementById('modalTitle').textContent = 'Nova Filial';
        document.getElementById('field1Label').textContent = 'Nome da Filial';
        document.getElementById('field1Input').placeholder = 'Ex: SÃ£o Paulo';
        document.getElementById('field2Label').textContent = 'Saldo Inicial (R$)';
        document.getElementById('field2Input').placeholder = '5000';
    }
    openModal('addModal');
}

function showEditCompanyModal(idx) {
    editingItem = { type: 'company', idx };
    const company = companies[idx];
    document.getElementById('modalTitle').textContent = 'Editar Empresa';
    document.getElementById('field1Label').textContent = 'Nome da Empresa';
    document.getElementById('field1Input').value = company.name;
    document.getElementById('field2Label').textContent = 'Budget Mensal (R$)';
    document.getElementById('field2Input').value = company.monthlyBudget || '';
    document.getElementById('addSubmitText').textContent = 'Salvar';
    document.getElementById('logoGroup').style.display = 'block';

    // Show existing logo or reset
    if (company.logo) {
        document.getElementById('logoPreview').innerHTML = `<img src="${company.logo}" style="width: 100%; height: 100%; object-fit: contain;">`;
    } else {
        resetLogoUpload();
    }

    openModal('addModal');
}

function showEditBranchModal(idx) {
    editingItem = { type: 'branch', idx };
    const branch = companies[currentCompanyIdx].branches[idx];
    document.getElementById('modalTitle').textContent = 'Editar Filial';
    document.getElementById('field1Label').textContent = 'Nome da Filial';
    document.getElementById('field1Input').value = branch.name;
    document.getElementById('field2Label').textContent = 'Saldo Atual (R$)';
    document.getElementById('field2Input').value = branch.balance;
    document.getElementById('addSubmitText').textContent = 'Salvar';
    openModal('addModal');
}

function submitAdd() {
    const name = document.getElementById('field1Input').value.trim();
    const value = parseFloat(document.getElementById('field2Input').value) || 0;

    if (!name || name.length < 2) {
        setFieldState('field1Input', 'field1Icon', 'field1Error', false, 'Nome deve ter pelo menos 2 caracteres');
        document.getElementById('field1Input').focus();
        return;
    }

    if (editingItem) {
        if (editingItem.type === 'company') {
            const old = companies[editingItem.idx].name;
            companies[editingItem.idx].name = name;
            companies[editingItem.idx].monthlyBudget = value;
            // Update logo only if a new one was uploaded
            if (currentLogoData) {
                companies[editingItem.idx].logo = currentLogoData;
            }
            addAuditEntry('Empresa editada', `"${old}" â†’ "${name}"`, 'info');
            showToast('success', 'Empresa atualizada', `"${name}" foi atualizada com sucesso.`);
        } else if (editingItem.type === 'branch') {
            const old = companies[currentCompanyIdx].branches[editingItem.idx].name;
            companies[currentCompanyIdx].branches[editingItem.idx].name = name;
            companies[currentCompanyIdx].branches[editingItem.idx].balance = value;
            addAuditEntry('Filial editada', `"${old}" â†’ "${name}"`, 'info');
            showToast('success', 'Filial atualizada', `"${name}" foi atualizada com sucesso.`);
        }
        editingItem = null;
    } else {
        if (currentView === 'companies') {
            companies.push(createCompany(name, value, currentLogoData));
            addAuditEntry('Empresa criada', `"${name}" com budget de ${formatCurrency(value)}`, 'success');
            showToast('success', 'Empresa criada!', `"${name}" foi adicionada com sucesso.`);
        } else if (currentView === 'company') {
            companies[currentCompanyIdx].branches.push(createBranch(name, value));
            addAuditEntry('Filial criada', `"${name}" em "${companies[currentCompanyIdx].name}"`, 'success');
            showToast('success', 'Filial criada!', `"${name}" foi adicionada com sucesso.`);
        }
    }
    currentLogoData = null;

    save();
    closeModal('addModal');
}

// ============================================================
// CRIAR OBJETOS
// ============================================================
function createCompany(name, budget, logo = null) {
    return { id: Date.now(), name, logo, monthlyBudget: budget, branches: [], createdAt: new Date().toISOString() };
}

function createBranch(name, balance) {
    return {
        id: Date.now(),
        name,
        balance,
        campaigns: [],
        campaignGroups: [],
        sales: [],
        leadsReportSent: false, // Step 1: Branch -> Me
        executiveReportSent: false, // Step 2: Me -> Branch
        lastExecutiveReportDate: null,
        budget: 0,
        createdAt: new Date().toISOString()
    };
}

// ============================================================
// DELETAR
// ============================================================
function deleteCompany(idx) {
    deleteCompanyConfirm(idx);
}

function deleteCompanyConfirm(idx) {
    const name = companies[idx].name;
    showConfirm(
        'Deletar Empresa',
        `Tem certeza que deseja deletar "${name}" e todos os seus dados? Esta aÃ§Ã£o nÃ£o pode ser desfeita.`,
        'ðŸ—‘ï¸',
        () => {
            companies.splice(idx, 1);
            addAuditEntry('Empresa deletada', `"${name}"`, 'delete');
            showToast('warning', 'Empresa deletada', `"${name}" foi removida.`);
            save();
            goToHome();
        }
    );
}

function deleteBranchConfirm() {
    const branch = companies[currentCompanyIdx].branches[currentBranchIdx];
    showConfirm(
        'Deletar Filial',
        `Tem certeza que deseja deletar "${branch.name}"? Todos os dados serÃ£o perdidos.`,
        'ðŸ—‘ï¸',
        () => {
            const name = branch.name;
            companies[currentCompanyIdx].branches.splice(currentBranchIdx, 1);
            currentBranchIdx = null;
            currentView = 'company';
            addAuditEntry('Filial deletada', `"${name}"`, 'delete');
            showToast('warning', 'Filial deletada', `"${name}" foi removida.`);
            save();
            selectCompany(currentCompanyIdx);
        }
    );
}

function deleteBranchByIdx(idx) {
    const branch = companies[currentCompanyIdx].branches[idx];
    showConfirm(
        'Deletar Filial',
        `Tem certeza que deseja deletar "${branch.name}"?`,
        'ðŸ—‘ï¸',
        () => {
            const name = branch.name;
            companies[currentCompanyIdx].branches.splice(idx, 1);
            addAuditEntry('Filial deletada', `"${name}"`, 'delete');
            showToast('warning', 'Filial deletada', `"${name}" foi removida.`);
            save();
            renderCompany();
        }
    );
}

// ============================================================
// CAMPANHAS
// ============================================================
function showCampaignModal() {
    currentCampaignPurpose = 'vendas';
    document.getElementById('campaignNameInput').value = '';
    document.getElementById('campaignSpendInput').value = '';
    document.getElementById('campaignNameInput').className = 'form-input';
    document.getElementById('campaignSpendInput').className = 'form-input';
    document.getElementById('campaignNameIcon').innerHTML = '';
    document.getElementById('campaignSpendIcon').innerHTML = '';
    document.getElementById('campaignNameError').classList.add('hidden');
    document.getElementById('campaignSpendError').classList.add('hidden');
    document.getElementById('campaignModalTitle').textContent = 'Nova Campanha';
    editingItem = null;
    updatePurposeButtons();
    populateCampaignGroupSelect();
    openModal('campaignModal');
}

function editCampaign(idx) {
    const campaign = companies[currentCompanyIdx].branches[currentBranchIdx].campaigns[idx];
    editingItem = { type: 'campaign', idx };
    document.getElementById('campaignModalTitle').textContent = 'Editar Campanha';
    document.getElementById('campaignNameInput').value = campaign.name;
    document.getElementById('campaignSpendInput').value = campaign.spend;
    currentCampaignPurpose = campaign.purpose;
    updatePurposeButtons();
    populateCampaignGroupSelect(campaign.groupId);
    openModal('campaignModal');
}

function populateCampaignGroupSelect(selectedGroupId = '') {
    const branch = companies[currentCompanyIdx].branches[currentBranchIdx];
    const groups = branch.campaignGroups || [];
    const select = document.getElementById('campaignGroupSelect');
    select.innerHTML = '<option value="">Sem grupo</option>';
    groups.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = g.name;
        if (g.id === selectedGroupId) opt.selected = true;
        select.appendChild(opt);
    });
}

function setCampaignPurpose(purpose) {
    currentCampaignPurpose = purpose;
    updatePurposeButtons();
}

function updatePurposeButtons() {
    ['vendas', 'leads', 'marca'].forEach(p => {
        const btn = document.getElementById('purpose' + p.charAt(0).toUpperCase() + p.slice(1));
        if (btn) {
            btn.classList.toggle('active', currentCampaignPurpose === p);
            btn.setAttribute('aria-pressed', currentCampaignPurpose === p);
        }
    });
}

function submitCampaign() {
    const name = document.getElementById('campaignNameInput').value.trim();
    const spend = parseFloat(document.getElementById('campaignSpendInput').value);
    const groupId = document.getElementById('campaignGroupSelect').value || null;
    let valid = true;

    if (!name || name.length < 3) {
        setFieldState('campaignNameInput', 'campaignNameIcon', 'campaignNameError', false, 'Nome deve ter pelo menos 3 caracteres');
        valid = false;
    }
    if (!spend || spend <= 0) {
        setFieldState('campaignSpendInput', 'campaignSpendIcon', 'campaignSpendError', false, 'Gasto deve ser maior que zero');
        valid = false;
    }
    if (!valid) return;

    const branch = companies[currentCompanyIdx].branches[currentBranchIdx];

    if (editingItem && editingItem.type === 'campaign') {
        const old = branch.campaigns[editingItem.idx].name;
        branch.campaigns[editingItem.idx] = { ...branch.campaigns[editingItem.idx], name, purpose: currentCampaignPurpose, spend, groupId };
        addAuditEntry('Campanha editada', `"${old}" â†’ "${name}"`, 'info');
        showToast('success', 'Campanha atualizada', `"${name}" foi atualizada.`);
        editingItem = null;
    } else {
        branch.campaigns.push({ id: Date.now(), name, purpose: currentCampaignPurpose, spend, groupId, createdAt: new Date().toISOString() });
        addAuditEntry('Campanha criada', `"${name}" em "${branch.name}"`, 'success');
        showToast('success', 'Campanha criada!', `"${name}" foi adicionada.`);
    }

    save();
    closeModal('campaignModal');
}

function deleteCampaign(idx) {
    const campaign = companies[currentCompanyIdx].branches[currentBranchIdx].campaigns[idx];
    showConfirm(
        'Deletar Campanha',
        `Deletar "${campaign.name}"?`,
        'ðŸ“Œ',
        () => {
            const name = campaign.name;
            companies[currentCompanyIdx].branches[currentBranchIdx].campaigns.splice(idx, 1);
            addAuditEntry('Campanha deletada', `"${name}"`, 'delete');
            showToast('warning', 'Campanha deletada', `"${name}" foi removida.`);
            save();
        }
    );
}

// ============================================================
// GRUPOS DE CAMPANHAS
// ============================================================
function showCampaignGroupModal() {
    document.getElementById('groupNameInput').value = '';
    document.getElementById('groupObjectiveInput').value = '';
    openModal('campaignGroupModal');
}

function submitCampaignGroup() {
    const name = document.getElementById('groupNameInput').value.trim();
    if (!name) { showToast('error', 'Erro', 'Informe o nome do grupo.'); return; }
    const branch = companies[currentCompanyIdx].branches[currentBranchIdx];
    if (!branch.campaignGroups) branch.campaignGroups = [];
    const group = { id: 'grp_' + Date.now(), name, objective: document.getElementById('groupObjectiveInput').value.trim(), createdAt: new Date().toISOString() };
    branch.campaignGroups.push(group);
    addAuditEntry('Grupo de campanhas criado', `"${name}"`, 'success');
    showToast('success', 'Grupo criado!', `"${name}" foi adicionado.`);
    save();
    closeModal('campaignGroupModal');
}

function deleteCampaignGroup(groupId) {
    const branch = companies[currentCompanyIdx].branches[currentBranchIdx];
    const group = (branch.campaignGroups || []).find(g => g.id === groupId);
    if (!group) return;
    showConfirm('Deletar Grupo', `Deletar grupo "${group.name}"? As campanhas do grupo nÃ£o serÃ£o deletadas.`, 'ðŸ“', () => {
        branch.campaignGroups = branch.campaignGroups.filter(g => g.id !== groupId);
        branch.campaigns.forEach(c => { if (c.groupId === groupId) c.groupId = null; });
        addAuditEntry('Grupo deletado', `"${group.name}"`, 'delete');
        showToast('warning', 'Grupo deletado', `"${group.name}" foi removido.`);
        save();
    });
}

// ============================================================
// VENDAS
// ============================================================
function showSaleModal() {
    editingItem = null;
    document.getElementById('saleSubmitText').textContent = 'Registrar Venda';
    document.getElementById('saleModalTitle').textContent = 'ðŸ’° Registrar Venda';
    ['clientNameInput', 'saleValueInput', 'adhesionValueInput', 'commissionValueInput', 'installmentsInput', 'installmentValueInput', 'saleProductInput', 'saleNotesInput'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.value = ''; el.className = el.tagName === 'TEXTAREA' ? 'form-input' : 'form-input'; }
    });
    document.getElementById('saleChannelInput').value = '';
    document.getElementById('saleDateInput').value = new Date().toISOString().split('T')[0];
    ['clientNameIcon', 'saleValueIcon'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
    ['clientNameError', 'saleValueError'].forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
    setHasInstallment(false);
    openModal('saleModal');
}

function editSale(idx) {
    const branch = companies[currentCompanyIdx].branches[currentBranchIdx];
    const sale = branch.sales[idx];
    editingItem = { type: 'sale', idx };
    document.getElementById('saleSubmitText').textContent = 'Salvar AlteraÃ§Ãµes';
    document.getElementById('saleModalTitle').textContent = 'âœï¸ Editar Venda';
    document.getElementById('clientNameInput').value = sale.clientName;
    document.getElementById('saleDateInput').value = sale.date;
    document.getElementById('saleValueInput').value = sale.saleValue || '';
    document.getElementById('adhesionValueInput').value = sale.adhesionValue || '';
    document.getElementById('commissionValueInput').value = sale.commissionValue || '';

    // Aplicar mÃ¡scaras
    formatCurrencyInput(document.getElementById('saleValueInput'));
    formatCurrencyInput(document.getElementById('adhesionValueInput'));
    formatCurrencyInput(document.getElementById('commissionValueInput'));

    document.getElementById('saleProductInput').value = sale.product || '';
    document.getElementById('saleChannelInput').value = sale.channel || '';
    document.getElementById('saleNotesInput').value = sale.notes || '';
    setHasInstallment(sale.hasInstallment);
    if (sale.hasInstallment) {
        document.getElementById('installmentsInput').value = sale.installments;
        document.getElementById('installmentValueInput').value = sale.installmentValue;
        formatCurrencyInput(document.getElementById('installmentValueInput'));
    }
    openModal('saleModal');
}

function setHasInstallment(value) {
    hasInstallment = value;
    document.getElementById('noInstallment').classList.toggle('active', !value);
    document.getElementById('yesInstallment').classList.toggle('active', value);
    document.getElementById('noInstallment').setAttribute('aria-pressed', !value);
    document.getElementById('yesInstallment').setAttribute('aria-pressed', value);
    document.getElementById('installmentDetailsGroup').classList.toggle('hidden', !value);
}

function submitSale() {
    const clientName = document.getElementById('clientNameInput').value.trim();
    const saleValue = getCurrencyValue(document.getElementById('saleValueInput'));
    const adhesionValue = getCurrencyValue(document.getElementById('adhesionValueInput'));
    const commissionValue = getCurrencyValue(document.getElementById('commissionValueInput'));
    const date = document.getElementById('saleDateInput').value;
    const product = document.getElementById('saleProductInput').value.trim();
    const channel = document.getElementById('saleChannelInput').value;
    const notes = document.getElementById('saleNotesInput').value.trim();
    let valid = true;

    if (!clientName || clientName.length < 2) {
        setFieldState('clientNameInput', 'clientNameIcon', 'clientNameError', false, 'Nome deve ter pelo menos 2 caracteres');
        valid = false;
    }
    if (!saleValue || saleValue <= 0) {
        setFieldState('saleValueInput', 'saleValueIcon', 'saleValueError', false, 'Valor deve ser maior que zero');
        valid = false;
    }
    if (!date) { showToast('error', 'Erro', 'Informe a data da venda.'); valid = false; }
    if (!valid) return;

    let totalLTV = saleValue + adhesionValue;
    let installments = 0, installmentValue = 0;

    if (hasInstallment) {
        installments = parseInt(document.getElementById('installmentsInput').value) || 0;
        installmentValue = getCurrencyValue(document.getElementById('installmentValueInput'));
        if (!installments || !installmentValue) {
            showToast('error', 'Erro', 'Preencha os dados de parcelamento.');
            return;
        }
        totalLTV += installmentValue * installments;
    }

    const branch = companies[currentCompanyIdx].branches[currentBranchIdx];
    const totalCampaignSpend = branch.campaigns.reduce((s, c) => s + c.spend, 0);
    const roi = calculateROI(totalLTV, totalCampaignSpend);

    const saleObj = { id: Date.now(), clientName, saleValue, adhesionValue, commissionValue, hasInstallment, installments, installmentValue, totalLTV, roi, date, product, channel, notes, createdAt: new Date().toISOString() };

    if (editingItem && editingItem.type === 'sale') {
        saleObj.id = branch.sales[editingItem.idx].id;
        saleObj.createdAt = branch.sales[editingItem.idx].createdAt;
        branch.sales[editingItem.idx] = saleObj;
        addAuditEntry('Venda editada', `Cliente: "${clientName}", Valor: ${formatCurrency(saleValue)}`, 'info');
        showToast('success', 'Venda atualizada!', `Venda de "${clientName}" foi atualizada.`);
        editingItem = null;
    } else {
        branch.sales.push(saleObj);
        addAuditEntry('Venda registrada', `Cliente: "${clientName}", LTV: ${formatCurrency(totalLTV)}, ROI: ${roi}%`, 'success');
        showToast('success', 'Venda registrada!', `${formatCurrency(totalLTV)} de LTV adicionado.`);

        // NotificaÃ§Ã£o automÃ¡tica de ROI
        if (roi > 100) {
            addSystemNotification('success', 'Meta de ROI atingida!', `${branch.name}: ROI de ${roi}% na venda de "${clientName}"`);
        }
    }

    save();
    closeModal('saleModal');
}

function deleteSale(idx) {
    const sale = companies[currentCompanyIdx].branches[currentBranchIdx].sales[idx];
    showConfirm(
        'Deletar Venda',
        `Deletar venda de "${sale.clientName}" (${formatCurrency(sale.saleValue || 0)})?`,
        'ðŸ’°',
        () => {
            const name = sale.clientName;
            companies[currentCompanyIdx].branches[currentBranchIdx].sales.splice(idx, 1);
            addAuditEntry('Venda deletada', `Cliente: "${name}"`, 'delete');
            showToast('warning', 'Venda deletada', `Venda de "${name}" foi removida.`);
            save();
        }
    );
}

// ============================================================
// ORÃ‡AMENTOS
// ============================================================
function openBudgetModal() {
    const content = document.getElementById('budgetContent');
    if (currentView === 'branch') {
        const branch = companies[currentCompanyIdx].branches[currentBranchIdx];
        const dailySpend = branch.campaigns.reduce((s, c) => s + c.spend, 0);
        const budget = branch.budget || 0;
        const pct = budget > 0 ? Math.min(100, Math.round((dailySpend / budget) * 100)) : 0;
        const color = pct >= 90 ? 'var(--danger)' : pct >= 70 ? 'var(--warning)' : 'var(--secondary)';

        content.innerHTML = `
            <div class="form-group">
                <label class="form-label" for="branchBudgetInput">OrÃ§amento DiÃ¡rio para "${branch.name}" (R$)</label>
                <input type="number" class="form-input" id="branchBudgetInput" value="${budget}" min="0" step="0.01" placeholder="0">
                <div class="form-hint">Defina o limite de gasto diÃ¡rio para esta filial.</div>
            </div>
            ${budget > 0 ? `
            <div class="budget-card">
                <div class="budget-header">
                    <span class="budget-name">UtilizaÃ§Ã£o Atual</span>
                    <span class="budget-pct" style="color:${color};">${pct}%</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width:${pct}%;background:${color};"></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-secondary);margin-top:8px;">
                    <span>Gasto: ${formatCurrency(dailySpend)}</span>
                    <span>Limite: ${formatCurrency(budget)}</span>
                </div>
            </div>` : ''}
            <button class="btn btn-primary" onclick="saveBranchBudget()" style="width:100%;margin-top:8px;">
                <i class="fas fa-save"></i> Salvar OrÃ§amento
            </button>`;
    } else if (currentView === 'company') {
        const company = companies[currentCompanyIdx];
        let html = '<div style="display:flex;flex-direction:column;gap:12px;">';
        company.branches.forEach((branch, idx) => {
            const dailySpend = branch.campaigns.reduce((s, c) => s + c.spend, 0);
            const budget = branch.budget || 0;
            const pct = budget > 0 ? Math.min(100, Math.round((dailySpend / budget) * 100)) : 0;
            const color = pct >= 90 ? 'var(--danger)' : pct >= 70 ? 'var(--warning)' : 'var(--secondary)';
            html += `
                <div class="budget-card">
                    <div class="budget-header">
                        <span class="budget-name">${branch.name}</span>
                        <span class="budget-pct" style="color:${budget > 0 ? color : 'var(--text-tertiary)'};">${budget > 0 ? pct + '%' : 'Sem limite'}</span>
                    </div>
                    <div style="display:flex;gap:8px;align-items:center;margin-top:8px;">
                        <input type="number" class="form-input" id="budget_${idx}" value="${budget}" min="0" step="0.01" placeholder="Sem limite" style="flex:1;">
                        <button class="btn btn-sm btn-primary" onclick="saveBranchBudgetByIdx(${idx})"><i class="fas fa-save"></i></button>
                    </div>
                    ${budget > 0 ? `
                    <div class="progress-bar" style="margin-top:8px;">
                        <div class="progress-fill" style="width:${pct}%;background:${color};"></div>
                    </div>` : ''}
                </div>`;
        });
        html += '</div>';
        content.innerHTML = html;
    }
    openModal('budgetModal');
}

function saveBranchBudget() {
    const val = parseFloat(document.getElementById('branchBudgetInput').value) || 0;
    companies[currentCompanyIdx].branches[currentBranchIdx].budget = val;
    addAuditEntry('OrÃ§amento atualizado', `${companies[currentCompanyIdx].branches[currentBranchIdx].name}: ${formatCurrency(val)}/dia`, 'info');
    showToast('success', 'OrÃ§amento salvo', `Limite de ${formatCurrency(val)}/dia definido.`);
    save();
    closeModal('budgetModal');
}

function saveBranchBudgetByIdx(idx) {
    const val = parseFloat(document.getElementById('budget_' + idx).value) || 0;
    companies[currentCompanyIdx].branches[idx].budget = val;
    addAuditEntry('OrÃ§amento atualizado', `${companies[currentCompanyIdx].branches[idx].name}: ${formatCurrency(val)}/dia`, 'info');
    showToast('success', 'OrÃ§amento salvo', `Limite de ${formatCurrency(val)}/dia definido.`);
    save();
}

// ============================================================
// PREVISÃƒO DE ROI
// ============================================================
function openRoiForecastModal() {
    const branch = companies[currentCompanyIdx].branches[currentBranchIdx];
    const kpis = calculateAdvancedKPIs(branch);
    const content = document.getElementById('roiForecastContent');

    const avgMonthlySales = branch.sales.length > 0 ? branch.sales.length / Math.max(1, getMonthsActive(branch)) : 0;
    const avgLTV = kpis.avgTicket;
    const dailySpend = branch.campaigns.reduce((s, c) => s + c.spend, 0);

    const scenarios = [
        { label: 'Conservador (-20%)', multiplier: 0.8, color: 'var(--warning)' },
        { label: 'Atual (base)', multiplier: 1.0, color: 'var(--primary)' },
        { label: 'Otimista (+30%)', multiplier: 1.3, color: 'var(--secondary)' },
    ];

    let html = `
        <div class="roi-forecast-card">
            <div style="font-weight:700;color:var(--text-primary);margin-bottom:12px;font-size:15px;">
                <i class="fas fa-calculator" style="color:var(--purple);"></i> ProjeÃ§Ã£o para os prÃ³ximos 30 dias
            </div>
            <div style="font-size:12px;color:var(--text-secondary);margin-bottom:16px;">
                Baseado em ${branch.sales.length} vendas histÃ³ricas Â· Gasto diÃ¡rio: ${formatCurrency(dailySpend)}
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">`;

    scenarios.forEach(s => {
        const projectedSales = Math.round(avgMonthlySales * s.multiplier);
        const projectedRevenue = projectedSales * avgLTV;
        const projectedSpend = dailySpend * 30;
        const projectedROI = projectedSpend > 0 ? Math.round(((projectedRevenue - projectedSpend) / projectedSpend) * 100) : 0;

        html += `
            <div style="padding:14px;background:rgba(255,255,255,0.03);border:1px solid ${s.color}33;border-radius:10px;text-align:center;">
                <div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px;font-weight:600;">${s.label}</div>
                <div style="font-size:20px;font-weight:800;color:${s.color};margin-bottom:4px;">${projectedROI}%</div>
                <div style="font-size:11px;color:var(--text-secondary);">ROI Projetado</div>
                <div style="margin-top:8px;font-size:12px;color:var(--text-secondary);">
                    ${projectedSales} vendas Â· ${formatCurrency(projectedRevenue)}
                </div>
            </div>`;
    });

    html += `
            </div>
        </div>
        <div style="padding:14px;background:rgba(255,255,255,0.03);border-radius:10px;border:1px solid var(--dark-border);">
            <div style="font-weight:700;color:var(--text-primary);margin-bottom:10px;">Dados HistÃ³ricos</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;">
                <div><span style="color:var(--text-secondary);">ROI Atual:</span> <strong style="color:${kpis.roi >= 0 ? 'var(--secondary)' : 'var(--danger)'};">${kpis.roi}%</strong></div>
                <div><span style="color:var(--text-secondary);">Ticket MÃ©dio:</span> <strong>${formatCurrency(kpis.avgTicket)}</strong></div>
                <div><span style="color:var(--text-secondary);">Total Investido:</span> <strong>${formatCurrency(kpis.totalSpend)}</strong></div>
                <div><span style="color:var(--text-secondary);">Receita Total:</span> <strong>${formatCurrency(kpis.totalRevenue)}</strong></div>
            </div>
        </div>`;

    content.innerHTML = html;
    openModal('roiForecastModal');
}

function getMonthsActive(branch) {
    if (branch.sales.length === 0) return 1;
    const dates = branch.sales.map(s => new Date(s.date + 'T00:00:00'));
    const min = new Date(Math.min(...dates));
    const max = new Date(Math.max(...dates));
    const months = (max.getFullYear() - min.getFullYear()) * 12 + (max.getMonth() - min.getMonth()) + 1;
    return Math.max(1, months);
}

// ============================================================
// NOTIFICAÃ‡Ã•ES
// ============================================================
function addSystemNotification(type, title, message) {
    const notif = { id: Date.now(), type, title, message, read: false, timestamp: new Date().toISOString() };
    notifications.unshift(notif);
    if (notifications.length > 100) notifications = notifications.slice(0, 100);
    saveNotifications();
    updateNotificationBadge();
}

function updateNotificationBadge() {
    const unread = notifications.filter(n => !n.read).length;
    const badge = document.getElementById('notificationBadge');
    if (badge) {
        badge.textContent = unread;
        badge.style.display = unread > 0 ? 'flex' : 'none';
        badge.setAttribute('aria-label', `${unread} notificaÃ§Ãµes nÃ£o lidas`);
    }
}

function openNotificationsModal() {
    updateNotifications();
    openModal('notificationsModal');
}

function markAllNotificationsRead() {
    notifications.forEach(n => n.read = true);
    saveNotifications();
    updateNotificationBadge();
    updateNotifications();
    showToast('info', 'NotificaÃ§Ãµes', 'Todas marcadas como lidas.');
}

function updateNotifications() {
    const container = document.getElementById('notificationsContainer');
    if (!container) return;

    // Gerar notificaÃ§Ãµes automÃ¡ticas de sistema
    const systemNotifs = [];
    companies.forEach(company => {
        company.branches.forEach(branch => {
            const campaigns = branch.campaigns || [];
            const spend = campaigns.reduce((s, c) => s + c.spend, 0);
            const revenue = branch.sales.reduce((s, sale) => s + sale.totalLTV, 0);
            const roi = spend > 0 ? Math.round(((revenue - spend) / spend) * 100) : 0;
            const health = getHealthStatus(branch.balance, spend);
            const budget = branch.budget || 0;
            const budgetPct = budget > 0 ? Math.round((spend / budget) * 100) : 0;

            if (branch.balance <= 0) {
                systemNotifs.push({ type: 'critical', icon: 'exclamation-circle', title: 'Saldo Esgotado', message: `${branch.name} nÃ£o tem saldo. Recarga urgente!`, time: 'Agora' });
            } else if (health.days < alertSettings.balanceDays) {
                systemNotifs.push({ type: 'warning', icon: 'clock', title: 'Saldo CrÃ­tico', message: `${branch.name}: apenas ${health.days} dias de saldo restante.`, time: 'Hoje' });
            }

            if (roi < alertSettings.roiThreshold && spend > 0) {
                systemNotifs.push({ type: 'warning', icon: 'chart-line', title: 'ROI Abaixo do Esperado', message: `${branch.name}: ROI de ${roi}% (limite: ${alertSettings.roiThreshold}%)`, time: 'Hoje' });
            }

            if (budget > 0 && budgetPct >= alertSettings.budgetThreshold) {
                systemNotifs.push({ type: 'warning', icon: 'wallet', title: 'OrÃ§amento PrÃ³ximo do Limite', message: `${branch.name}: ${budgetPct}% do orÃ§amento utilizado.`, time: 'Hoje' });
            }

            if (roi > 100) {
                systemNotifs.push({ type: 'success', icon: 'trophy', title: 'Meta de ROI Atingida!', message: `${branch.name}: ROI de ${roi}% â€” excelente performance!`, time: 'Hoje' });
            }
        });
    });

    const allNotifs = [...notifications.slice(0, 20), ...systemNotifs];

    if (allNotifs.length === 0) {
        container.innerHTML = '<div class="no-branches-message" style="padding:30px;">Nenhuma notificaÃ§Ã£o no momento.</div>';
        updateNotificationBadge();
        return;
    }

    const colors = { critical: 'var(--danger)', success: 'var(--secondary)', warning: 'var(--warning)', info: 'var(--primary)' };
    container.innerHTML = allNotifs.map(notif => {
        const color = colors[notif.type] || 'var(--primary)';
        const time = notif.timestamp ? new Date(notif.timestamp).toLocaleString('pt-BR') : (notif.time || '');
        return `
            <div class="notification-item ${!notif.read ? 'unread' : ''}">
                <div class="notification-dot" style="background:${color};"></div>
                <div style="flex:1;">
                    <div style="font-weight:600;color:var(--text-primary);font-size:13px;display:flex;align-items:center;gap:6px;">
                        <i class="fas fa-${notif.icon || 'bell'}" style="color:${color};font-size:12px;"></i>
                        ${notif.title}
                    </div>
                    <div style="font-size:12px;color:var(--text-secondary);margin-top:3px;">${notif.message}</div>
                </div>
                <div style="font-size:11px;color:var(--text-tertiary);white-space:nowrap;">${time}</div>
            </div>`;
    }).join('');

    updateNotificationBadge();
}

// ============================================================
// ALERTAS INLINE
// ============================================================
function generateAlerts() {
    const alerts = [];
    companies.forEach((company, compIdx) => {
        company.branches.forEach((branch, branchIdx) => {
            const alertId = `alert_${compIdx}_${branchIdx}_balance_check`;
            if (dismissedAlerts.includes(alertId)) return;

            const dailySpend = branch.campaigns.reduce((s, c) => s + c.spend, 0);
            const health = getHealthStatus(branch.balance, dailySpend);
            if (branch.balance <= 0) {
                alerts.push({ id: alertId, type: 'critical', title: 'Saldo Esgotado', message: `${branch.name} nÃ£o tem saldo disponÃ­vel.`, compIdx, branchIdx });
            } else if (health.days < alertSettings.balanceDays) {
                alerts.push({ id: alertId, type: 'warning', title: 'Saldo CrÃ­tico', message: `${branch.name}: apenas ${health.days} dias de saldo restante.`, compIdx, branchIdx });
            }
        });
    });
    return alerts;
}



function displayAlerts() {
    const alertContainer = document.getElementById('alertContainer');
    if (!alertContainer) return;
    const alerts = generateAlerts();
    if (alerts.length === 0) { alertContainer.innerHTML = ''; return; }
    alertContainer.innerHTML = alerts.slice(0, 3).map(a => `
        <div class="alert-banner" role="alert">
            <div class="alert-icon"><i class="fas fa-exclamation-circle"></i></div>
            <div class="alert-content">
                <div class="alert-title">${a.title}</div>
                <div class="alert-message">${a.message}</div>
            </div>
            <button class="alert-dismiss" onclick="dismissAlert('${a.id}')" aria-label="Remover alerta">
                <i class="fas fa-times"></i>
            </button>
        </div>`).join('');
}

// ============================================================
// INSIGHTS IA
// ============================================================
function generateAIInsights() {
    const insights = [];
    let bestROI = -Infinity, worstROI = Infinity;
    let bestPerformer = null, worstPerformer = null;
    let totalROI = 0, count = 0;

    companies.forEach((company, compIdx) => {
        company.branches.forEach((branch, branchIdx) => {
            const spend = branch.campaigns.reduce((s, c) => s + c.spend, 0);
            const revenue = branch.sales.reduce((s, sale) => s + sale.totalLTV, 0);
            const roi = spend > 0 ? Math.round(((revenue - spend) / spend) * 100) : 0;
            totalROI += roi; count++;
            if (roi > bestROI) { bestROI = roi; bestPerformer = { name: branch.name, company: company.name, roi, spend, revenue }; }
            if (roi < worstROI) { worstROI = roi; worstPerformer = { name: branch.name, company: company.name, roi, spend, revenue }; }
        });
    });

    const avgROI = count > 0 ? Math.round(totalROI / count) : 0;

    if (bestPerformer && bestROI > avgROI + 20) {
        insights.push({ type: 'success', icon: 'star', title: 'Estrela em AscensÃ£o', message: `${bestPerformer.name} (${bestPerformer.company}) estÃ¡ com ROI de ${bestROI}%. Considere aumentar o investimento!`, action: 'Aumentar Investimento' });
    }
    if (worstPerformer && worstROI < avgROI - 20) {
        insights.push({ type: 'warning', icon: 'chart-line', title: 'Oportunidade de OtimizaÃ§Ã£o', message: `${worstPerformer.name} estÃ¡ com ROI de ${worstROI}%. Recomendamos revisar as campanhas.`, action: 'Revisar Campanhas' });
    }
    if (count > 1 && bestPerformer && worstPerformer) {
        const diff = bestROI - worstROI;
        insights.push({ type: 'info', icon: 'lightbulb', title: 'AnÃ¡lise Comparativa', message: `DiferenÃ§a de ${diff}% entre melhor e pior performer. Oportunidade de realocar ${formatCurrency(Math.round(worstPerformer.spend * 0.3))} para a filial top.`, action: 'Ver Detalhes' });
    }
    if (count === 0) {
        insights.push({ type: 'info', icon: 'info-circle', title: 'Sem dados suficientes', message: 'Cadastre empresas, filiais, campanhas e vendas para receber insights personalizados.', action: 'ComeÃ§ar' });
    }
    return insights;
}

function displayInsights() {
    const container = document.getElementById('insightsContainer');
    if (!container) return;
    const insights = generateAIInsights();
    const colors = { success: 'var(--secondary)', warning: 'var(--warning)', info: 'var(--primary)' };
    container.innerHTML = insights.map(insight => `
        <div style="padding:16px;background:rgba(255,255,255,0.03);border-left:3px solid ${colors[insight.type]};border-radius:8px;margin-bottom:10px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <i class="fas fa-${insight.icon}" style="color:${colors[insight.type]};font-size:16px;"></i>
                <div style="font-weight:700;color:var(--text-primary);">${insight.title}</div>
            </div>
            <div style="font-size:13px;color:var(--text-secondary);margin-bottom:10px;">${insight.message}</div>
            <button class="btn btn-sm btn-secondary">${insight.action}</button>
        </div>`).join('');
}

// ============================================================
// EXPORTAÃ‡ÃƒO
// ============================================================
function exportSalesCSV() {
    const branch = companies[currentCompanyIdx].branches[currentBranchIdx];
    const sales = filterSalesByPeriod(branch.sales);
    const channelLabels = { google_ads: 'Google Ads', meta_ads: 'Meta Ads', tiktok_ads: 'TikTok Ads', organico: 'OrgÃ¢nico', indicacao: 'IndicaÃ§Ã£o', outro: 'Outro', '': 'NÃ£o informado' };
    const headers = ['Cliente', 'Data', 'Produto', 'Canal', 'Valor Venda', 'AdesÃ£o', 'ComissÃ£o', 'Parcelamento', 'LTV Total', 'ROI (%)'];
    const rows = sales.map(s => [
        s.clientName,
        s.date,
        s.product || '',
        channelLabels[s.channel || ''] || '',
        s.saleValue || 0,
        s.adhesionValue || 0,
        s.commissionValue || 0,
        s.hasInstallment ? `${s.installments}x de ${s.installmentValue}` : 'NÃ£o',
        s.totalLTV,
        s.roi || 0
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    downloadFile(csv, `vendas_${branch.name}_${new Date().toISOString().split('T')[0]}.csv`, 'text/csv');
    showToast('success', 'CSV exportado!', `${sales.length} vendas exportadas.`);
    addAuditEntry('ExportaÃ§Ã£o CSV', `${sales.length} vendas de "${branch.name}"`, 'info');
}

function exportSalesExcel() {
    if (typeof XLSX === 'undefined') { showToast('error', 'Erro', 'Biblioteca XLSX nÃ£o carregada.'); return; }
    const branch = companies[currentCompanyIdx].branches[currentBranchIdx];
    const sales = filterSalesByPeriod(branch.sales);
    const channelLabels = { google_ads: 'Google Ads', meta_ads: 'Meta Ads', tiktok_ads: 'TikTok Ads', organico: 'OrgÃ¢nico', indicacao: 'IndicaÃ§Ã£o', outro: 'Outro', '': 'NÃ£o informado' };
    const data = [
        ['Cliente', 'Data', 'Produto', 'Canal', 'Valor Venda', 'AdesÃ£o', 'ComissÃ£o', 'Parcelamento', 'LTV Total', 'ROI (%)'],
        ...sales.map(s => [s.clientName, s.date, s.product || '', channelLabels[s.channel || ''] || '', s.saleValue || 0, s.adhesionValue || 0, s.commissionValue || 0, s.hasInstallment ? `${s.installments}x de ${s.installmentValue}` : 'NÃ£o', s.totalLTV, s.roi || 0])
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vendas');
    XLSX.writeFile(wb, `vendas_${branch.name}_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast('success', 'Excel exportado!', `${sales.length} vendas exportadas.`);
    addAuditEntry('ExportaÃ§Ã£o Excel', `${sales.length} vendas de "${branch.name}"`, 'info');
}

function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
}

function downloadReportPDF() {
    showToast('info', 'Gerando PDF...', 'Aguarde um momento.');

    const primaryColor = (whiteLabel && whiteLabel.primaryColor) ? whiteLabel.primaryColor : '#00d4ff';
    const secondaryColor = '#1dd1a1';
    const dangerColor = '#ff6b6b';
    const warningColor = '#ffa502';
    const bgDark = '#0a0e27';
    const bgCard = '#141829';
    const textPrimary = '#f1f5f9';
    const textSecondary = '#94a3b8';
    const textTertiary = '#64748b';
    const primaryRgb = hexToRgb(primaryColor).join(',');
    const secondaryRgb = hexToRgb(secondaryColor).join(',');

    // Gera o conteÃºdo do relatÃ³rio diretamente (sem depender do modal)
    let reportContent = generatePremiumReport();

    // Substitui variÃ¡veis CSS por valores reais
    reportContent = reportContent
        .replace(/var\(--primary\)/g, primaryColor)
        .replace(/var\(--primary-light\)/g, primaryColor)
        .replace(/var\(--secondary\)/g, secondaryColor)
        .replace(/var\(--secondary-light\)/g, secondaryColor)
        .replace(/var\(--danger\)/g, dangerColor)
        .replace(/var\(--warning\)/g, warningColor)
        .replace(/var\(--purple\)/g, '#a29bfe')
        .replace(/var\(--text-primary\)/g, textPrimary)
        .replace(/var\(--text-secondary\)/g, textSecondary)
        .replace(/var\(--text-tertiary\)/g, textTertiary)
        .replace(/var\(--dark-bg\)/g, bgDark)
        .replace(/var\(--dark-surface\)/g, bgCard)
        .replace(/var\(--dark-surface-light\)/g, '#1a2332')
        .replace(/var\(--dark-border\)/g, 'rgba(255,255,255,0.08)')
        .replace(/var\(--dark-border-light\)/g, 'rgba(255,255,255,0.12)');

    const brandName = (whiteLabel && whiteLabel.brandName) ? whiteLabel.brandName : 'TrafficFlow Ultimate';
    const now = new Date();
    const dateStr = now.toLocaleDateString('pt-BR');
    const timeStr = now.toLocaleTimeString('pt-BR');

    const fullHTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>RelatÃ³rio Premium</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page { size: A4; margin: 15mm 12mm; }
  body {
    font-family: 'Segoe UI', Arial, sans-serif;
    background: ${bgDark};
    color: ${textPrimary};
    font-size: 13px;
    line-height: 1.5;
  }
  .pdf-cover {
    background: linear-gradient(135deg, ${bgDark} 0%, ${bgCard} 100%);
    border: 1px solid rgba(${primaryRgb}, 0.2);
    border-radius: 12px;
    padding: 40px;
    text-align: center;
    margin-bottom: 28px;
  }
  .pdf-cover-logo {
    width: 56px; height: 56px;
    background: linear-gradient(135deg, ${primaryColor}, ${secondaryColor});
    border-radius: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    font-weight: 900;
    color: ${bgDark};
    margin-bottom: 16px;
  }
  .pdf-cover h1 {
    font-size: 28px;
    font-weight: 800;
    color: ${primaryColor};
    margin-bottom: 6px;
  }
  .pdf-cover h2 {
    font-size: 16px;
    font-weight: 500;
    color: ${textSecondary};
    margin-bottom: 4px;
  }
  .pdf-cover .date {
    font-size: 12px;
    color: ${textTertiary};
    margin-top: 10px;
  }
  .pdf-divider {
    border: none;
    border-top: 1px solid rgba(${primaryRgb}, 0.15);
    margin: 20px 0;
  }
  .kpi-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-bottom: 20px;
  }
  .kpi-grid-4 {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-bottom: 20px;
  }
  .kpi-card {
    background: ${bgCard};
    border: 1px solid rgba(${primaryRgb}, 0.15);
    border-radius: 10px;
    padding: 16px;
  }
  .kpi-card.accent-primary { border-left: 4px solid ${primaryColor}; }
  .kpi-card.accent-secondary { border-left: 4px solid ${secondaryColor}; }
  .kpi-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: ${textSecondary};
    margin-bottom: 8px;
    font-weight: 600;
  }
  .kpi-value {
    font-size: 22px;
    font-weight: 800;
    margin-bottom: 4px;
  }
  .kpi-value.primary { color: ${primaryColor}; }
  .kpi-value.secondary { color: ${secondaryColor}; }
  .kpi-value.danger { color: ${dangerColor}; }
  .kpi-value.warning { color: ${warningColor}; }
  .kpi-value.center { text-align: center; }
  .kpi-label.center { text-align: center; }
  .section-title {
    font-size: 15px;
    font-weight: 700;
    color: ${textPrimary};
    border-left: 4px solid ${primaryColor};
    padding-left: 12px;
    margin: 24px 0 14px;
  }
  .summary-box {
    background: ${bgCard};
    border: 1px solid rgba(${primaryRgb}, 0.12);
    border-radius: 10px;
    padding: 18px;
    margin-bottom: 18px;
  }
  .summary-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    font-size: 13px;
    color: ${textSecondary};
  }
  .summary-grid strong { color: ${textPrimary}; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 18px;
    font-size: 12px;
  }
  th {
    background: rgba(${primaryRgb}, 0.12);
    color: ${primaryColor};
    padding: 10px 12px;
    text-align: left;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 2px solid rgba(${primaryRgb}, 0.3);
    font-weight: 700;
  }
  td {
    padding: 10px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    color: ${textSecondary};
  }
  tr:hover td { background: rgba(${primaryRgb}, 0.04); }
  .badge {
    display: inline-block;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    background: rgba(${primaryRgb}, 0.15);
    color: ${primaryColor};
  }
  .badge-success { background: rgba(${secondaryRgb}, 0.15); color: ${secondaryColor}; }
  .badge-danger { background: rgba(255,107,107,0.15); color: ${dangerColor}; }
  .performance-banner {
    border-radius: 8px;
    padding: 14px 18px;
    border-left: 4px solid;
    margin-top: 16px;
    font-weight: 600;
    font-size: 13px;
  }
  .branch-row {
    background: ${bgCard};
    border: 1px solid rgba(${primaryRgb}, 0.1);
    border-radius: 8px;
    padding: 14px 16px;
    margin-bottom: 10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .branch-name { font-weight: 600; color: ${textPrimary}; font-size: 14px; }
  .branch-meta { font-size: 12px; color: ${textSecondary}; margin-top: 3px; }
  .branch-roi { font-weight: 800; font-size: 18px; }
  .footer {
    text-align: center;
    margin-top: 36px;
    padding-top: 16px;
    border-top: 1px solid rgba(${primaryRgb}, 0.1);
    font-size: 11px;
    color: ${textTertiary};
  }

        .alert-dismiss, .smart-alert button, .toast-close {
            cursor: pointer !important;
            z-index: 100 !important;
            pointer-events: auto !important;
        }
        .smart-alert {
            transition: all 0.3s ease;
        }

    
        
        /* ===== GLASSMORPHISM PREMIUM ===== */
        .card, .kpi-card-advanced, .campaign-card, .modal-content {
            background: var(--glass-bg) !important;
            backdrop-filter: blur(20px) !important;
            border: 1px solid var(--glass-border) !important;
            box-shadow: var(--shadow-md) !important;
        }
        
        .card:hover, .campaign-card:hover {
            border-color: rgba(0, 212, 255, 0.3);
            box-shadow: var(--shadow-lg), var(--shadow-glow-primary);
            transform: translateY(-4px);
        }
        
        /* ===== ANIMAÃ‡Ã•ES PREMIUM ===== */
        
            to { opacity: 1; transform: translateY(0); }
        }
        
        
            to { opacity: 1; transform: translateX(0); }
        }
        
        
            50% { box-shadow: var(--shadow-glow-primary), 0 0 30px rgba(0, 212, 255, 0.25); }
        }
        
        .card { animation: fadeInUp 0.6s cubic-bezier(0.23, 1, 0.32, 1) forwards; }
        .nav-item { animation: slideInRight 0.4s cubic-bezier(0.23, 1, 0.32, 1) forwards; }
        
        /* ===== BOTÃ•ES PREMIUM ===== */
        .btn {
            position: relative;
            overflow: hidden;
            transition: all 0.3s cubic-bezier(0.23, 1, 0.32, 1);
            box-shadow: 0 4px 15px rgba(0, 212, 255, 0.2);
        }
        
        .btn::before {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            width: 0;
            height: 0;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.3);
            transform: translate(-50%, -50%);
            transition: width 0.6s, height 0.6s;
        }
        
        .btn:active::before {
            width: 300px;
            height: 300px;
        }
        
        .btn-primary {
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            box-shadow: 0 8px 24px rgba(0, 212, 255, 0.35);
        }
        
        .btn-primary:hover {
            transform: translateY(-3px);
            box-shadow: 0 12px 36px rgba(0, 212, 255, 0.5);
        }
        
        /* ===== INDICADORES DE SAÃšDE VISUAL ===== */
        .health-indicator {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
        }
        
        .health-indicator.critical {
            background: rgba(255, 107, 107, 0.15);
            color: #ff8787;
            border: 1px solid rgba(255, 107, 107, 0.3);
        }
        
        .health-indicator.warning {
            background: rgba(255, 159, 67, 0.15);
            color: #ffb366;
            border: 1px solid rgba(255, 159, 67, 0.3);
        }
        
        .health-indicator.success {
            background: rgba(29, 209, 161, 0.15);
            color: #4ddbb8;
            border: 1px solid rgba(29, 209, 161, 0.3);
        }
        
        /* ===== BARRA DE PROGRESSO VISUAL ===== */
        .progress-bar-premium {
            height: 6px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 10px;
            overflow: hidden;
            margin-top: 12px;
        }
        
        .progress-fill-premium {
            height: 100%;
            background: linear-gradient(90deg, var(--primary), var(--secondary));
            border-radius: 10px;
            transition: width 0.4s cubic-bezier(0.23, 1, 0.32, 1);
            box-shadow: 0 0 10px rgba(0, 212, 255, 0.5);
        }

    
        
        /* ===== HEALTH SCORE VISUAL ===== */
        .health-score-ring {
            width: 120px;
            height: 120px;
            border-radius: 50%;
            background: conic-gradient(
                var(--primary) 0deg,
                var(--primary) calc(var(--health-score) * 3.6deg),
                rgba(255, 255, 255, 0.05) calc(var(--health-score) * 3.6deg)
            );
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            font-size: 24px;
            font-weight: 800;
            color: var(--text-primary);
            box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.3);
        }
        
        .health-score-ring::before {
            content: '';
            position: absolute;
            width: 100px;
            height: 100px;
            border-radius: 50%;
            background: var(--dark-surface);
            z-index: 1;
        }
        
        .health-score-value {
            position: relative;
            z-index: 2;
        }
        
        /* ===== SPARKLINE CHARTS ===== */
        .sparkline {
            width: 100%;
            height: 30px;
            margin-top: 8px;
        }
        
        /* ===== TOOLTIP PREMIUM ===== */
        .tooltip {
            position: relative;
            display: inline-block;
            cursor: help;
        }
        
        .tooltip .tooltiptext {
            visibility: hidden;
            width: 200px;
            background-color: rgba(20, 24, 41, 0.95);
            color: var(--text-primary);
            text-align: center;
            border-radius: 8px;
            padding: 8px 12px;
            position: absolute;
            z-index: 1000;
            bottom: 125%;
            left: 50%;
            margin-left: -100px;
            opacity: 0;
            transition: opacity 0.3s;
            font-size: 12px;
            border: 1px solid var(--glass-border);
            backdrop-filter: blur(10px);
        }
        
        .tooltip .tooltiptext::after {
            content: '';
            position: absolute;
            top: 100%;
            left: 50%;
            margin-left: -5px;
            border-width: 5px;
            border-style: solid;
            border-color: rgba(20, 24, 41, 0.95) transparent transparent transparent;
        }
        
        .tooltip:hover .tooltiptext {
            visibility: visible;
            opacity: 1;
        }

    
        
        /* ===== BREADCRUMB ANIMADO ===== */
        .breadcrumb {
            animation: slideInRight 0.4s ease;
        }
        
        .breadcrumb-item {
            position: relative;
            transition: all 0.3s ease;
        }
        
        .breadcrumb-item::after {
            content: '';
            position: absolute;
            bottom: -2px;
            left: 0;
            width: 0;
            height: 2px;
            background: var(--primary);
            transition: width 0.3s ease;
        }
        
        .breadcrumb-item:hover::after {
            width: 100%;
        }
        
        /* ===== MODAL PREMIUM ===== */
        .modal {
            animation: fadeInUp 0.4s cubic-bezier(0.23, 1, 0.32, 1);
        }
        
        .modal-overlay {
            backdrop-filter: blur(5px);
            background: rgba(0, 0, 0, 0.4);
        }
        
        .modal-content {
            animation: slideInUp 0.4s cubic-bezier(0.23, 1, 0.32, 1);
        }
        
        
            to { opacity: 1; transform: translateY(0); }
        }

    </style>
</head>
<body>
  <div class="pdf-cover">
    <div class="pdf-cover-logo">TF</div>
    <h1>RelatÃ³rio Executivo Premium</h1>
    <h2>${brandName}</h2>
    <div class="date">Gerado em ${dateStr} Ã s ${timeStr}</div>
  </div>
  ${reportContent}
  <div class="footer">
    <p>RelatÃ³rio gerado pelo ${brandName} &mdash; Gestor de TrÃ¡fego &amp; ROI</p>
  </div>

    <!-- Theme Customizer Panel -->
    <div id="themePanel" style="position: fixed; top: 90px; right: 20px; width: 320px; background: var(--glass-bg); backdrop-filter: blur(20px); border: 1px solid var(--glass-border); border-radius: 16px; padding: 20px; z-index: 5000; box-shadow: var(--shadow-lg); display: none; max-height: 80vh; overflow-y: auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h3 style="margin: 0; font-size: 16px; font-weight: 700;">âš™ï¸ Personalizar Tema</h3>
            <button onclick="closeThemePanel()" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 18px;">
                <i class="fas fa-times"></i>
            </button>
        </div>
        
        <!-- Theme Toggle -->
        <div style="margin-bottom: 20px;">
            <label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 10px; text-transform: uppercase;">Modo</label>
            <div style="display: flex; gap: 10px;">
                <button onclick="setTheme('dark')" id="themeDarkBtn" style="flex: 1; padding: 10px; border: 2px solid var(--primary); background: rgba(0, 212, 255, 0.1); color: var(--primary); border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s;">
                    ðŸŒ™ Escuro
                </button>
                <button onclick="setTheme('light')" id="themeLightBtn" style="flex: 1; padding: 10px; border: 2px solid var(--border); background: transparent; color: var(--text-secondary); border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s;">
                    â˜€ï¸ Claro
                </button>
            </div>
        </div>
        
        <!-- Color Customization -->
        <div style="margin-bottom: 20px;">
            <label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 10px; text-transform: uppercase;">Cor PrimÃ¡ria</label>
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px;">
                <button onclick="setCustomColor('#00d4ff')" style="width: 100%; height: 40px; background: #00d4ff; border: 2px solid transparent; border-radius: 8px; cursor: pointer; transition: all 0.2s;" title="Cyan"></button>
                <button onclick="setCustomColor('#1dd1a1')" style="width: 100%; height: 40px; background: #1dd1a1; border: 2px solid transparent; border-radius: 8px; cursor: pointer; transition: all 0.2s;" title="Green"></button>
                <button onclick="setCustomColor('#a29bfe')" style="width: 100%; height: 40px; background: #a29bfe; border: 2px solid transparent; border-radius: 8px; cursor: pointer; transition: all 0.2s;" title="Purple"></button>
                <button onclick="setCustomColor('#ff6b6b')" style="width: 100%; height: 40px; background: #ff6b6b; border: 2px solid transparent; border-radius: 8px; cursor: pointer; transition: all 0.2s;" title="Red"></button>
                <button onclick="setCustomColor('#f59e0b')" style="width: 100%; height: 40px; background: #f59e0b; border: 2px solid transparent; border-radius: 8px; cursor: pointer; transition: all 0.2s;" title="Amber"></button>
                <button onclick="setCustomColor('#ec4899')" style="width: 100%; height: 40px; background: #ec4899; border: 2px solid transparent; border-radius: 8px; cursor: pointer; transition: all 0.2s;" title="Pink"></button>
                <button onclick="setCustomColor('#06b6d4')" style="width: 100%; height: 40px; background: #06b6d4; border: 2px solid transparent; border-radius: 8px; cursor: pointer; transition: all 0.2s;" title="Cyan"></button>
                <button onclick="setCustomColor('#8b5cf6')" style="width: 100%; height: 40px; background: #8b5cf6; border: 2px solid transparent; border-radius: 8px; cursor: pointer; transition: all 0.2s;" title="Violet"></button>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <input type="color" id="customColorPicker" value="#00d4ff" style="width: 40px; height: 40px; border: none; border-radius: 8px; cursor: pointer; padding: 0;" onchange="setCustomColor(this.value)">
                <span style="font-size: 12px; color: var(--text-tertiary);">Personalizada</span>
            </div>
        </div>
        
        <!-- Contrast -->
        <div style="margin-bottom: 20px;">
            <label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 10px; text-transform: uppercase;">Contraste</label>
            <input type="range" id="contrastSlider" min="80" max="150" value="100" style="width: 100%; cursor: pointer;" onchange="setContrast(this.value)">
            <div style="font-size: 11px; color: var(--text-tertiary); margin-top: 5px; text-align: center;" id="contrastValue">100%</div>
        </div>

        <!-- Reset -->
        <button onclick="resetTheme()" style="width: 100%; padding: 10px; background: rgba(255, 107, 107, 0.1); color: var(--danger); border: 1px solid var(--danger); border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s;">
            â†º Restaurar PadrÃ£o
        </button>
    </div>

    <!-- BotÃ£o Flutuante de Troca de Tema -->
    <button class="theme-floating-btn" id="themeToggleBtn" onclick="toggleTheme()" aria-label="Alternar entre modo escuro e claro" title="Alternar tema">
        <svg class="icon icon-sun" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
        <svg class="icon icon-moon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
    </button>

</body>
</html>`;

    // Abre uma nova janela e dispara o print (salvar como PDF)
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) {
        showToast('error', 'Bloqueado!', 'Permita pop-ups para este site e tente novamente.');
        return;
    }
    win.document.open();
    win.document.write(fullHTML);
    win.document.close();

    // Aguarda o carregamento completo antes de imprimir
    win.onload = function () {
        setTimeout(() => {
            win.focus();
            win.print();
        }, 600);
    };

    showToast('success', 'RelatÃ³rio aberto!', 'Use Ctrl+P / Cmd+P para salvar como PDF.');
    addAuditEntry('RelatÃ³rio PDF gerado', 'RelatÃ³rio executivo Premium', 'info');
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [0, 212, 255];
}

function downloadReportCSV() {
    if (currentBranchIdx === null) { showToast('error', 'Erro', 'Selecione uma filial primeiro.'); return; }
    exportSalesCSV();
}

function downloadReportExcel() {
    if (currentBranchIdx === null) { showToast('error', 'Erro', 'Selecione uma filial primeiro.'); return; }
    exportSalesExcel();
}

function exportData() {
    const data = { companies, version: '8.0', exportedAt: new Date().toISOString() };
    downloadFile(JSON.stringify(data, null, 2), `trafficflow_backup_${new Date().toISOString().split('T')[0]}.json`, 'application/json');
    showToast('success', 'Backup criado!', 'Arquivo JSON exportado com sucesso.');
    addAuditEntry('Backup exportado', 'Dados completos exportados', 'info');
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            showConfirm('Restaurar Backup', 'Isso irÃ¡ substituir todos os dados atuais. Continuar?', 'ðŸ“‚', () => {
                companies = data.companies || [];
                save();
                addAuditEntry('Backup restaurado', `Arquivo: ${file.name}`, 'warning');
                showToast('success', 'Dados restaurados!', 'Backup importado com sucesso.');
            });
        } catch (err) {
            showToast('error', 'Erro ao importar', 'Arquivo invÃ¡lido ou corrompido.');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

// ============================================================
// RELATÃ“RIO PREMIUM
// ============================================================
function openPremiumReport() {
    const container = document.getElementById('premiumReportContent');
    container.innerHTML = generatePremiumReport();
    openModal('premiumReportModal');
    // Gera o PDF automaticamente ao abrir o relatÃ³rio
    setTimeout(() => downloadReportPDF(), 400);
}

function generatePremiumReport() {
    if (currentBranchIdx !== null) {
        return generateBranchReport();
    } else if (currentCompanyIdx !== null) {
        return generateCompanyReport();
    }
    return '<p style="color:var(--text-secondary);text-align:center;padding:40px;">Selecione uma empresa ou filial para gerar o relatÃ³rio.</p>';
}

function generateBranchReport() {
    const company = companies[currentCompanyIdx];
    const branch = company.branches[currentBranchIdx];
    const kpis = calculateAdvancedKPIs(branch);
    const health = getHealthStatus(branch.balance, branch.campaigns.reduce((s, c) => s + c.spend, 0));
    const primaryColor = whiteLabel.primaryColor || '#00d4ff';
    const secondaryColor = '#1dd1a1';
    const primaryRgb = hexToRgb(primaryColor).join(',');
    const secondaryRgb = hexToRgb(secondaryColor).join(',');

    return `
        <div style="padding:20px;background:rgba(255,255,255,0.02);border-radius:12px;">
            <div style="text-align:center;margin-bottom:24px;padding-bottom:20px;border-bottom:1px solid rgba(255,255,255,0.1);">
                <div style="font-size:22px;font-weight:800;color:${primaryColor};margin-bottom:6px;">RelatÃ³rio Executivo</div>
                <div style="font-size:14px;color:var(--text-secondary);">${branch.name} Â· ${company.name}</div>
                <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">Gerado em ${new Date().toLocaleDateString('pt-BR')} Ã s ${new Date().toLocaleTimeString('pt-BR')}</div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px;">
                <div style="padding:14px;background:rgba(${primaryRgb},0.08);border-radius:8px;border-left:3px solid ${primaryColor};">
                    <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;margin-bottom:6px;">Investimento Total</div>
                    <div style="font-size:20px;font-weight:700;color:${primaryColor};">${formatCurrency(kpis.totalSpend)}</div>
                </div>
                <div style="padding:14px;background:rgba(${secondaryRgb},0.08);border-radius:8px;border-left:3px solid ${secondaryColor};">
                    <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;margin-bottom:6px;">Receita Gerada</div>
                    <div style="font-size:20px;font-weight:700;color:${secondaryColor};">${formatCurrency(kpis.totalRevenue)}</div>
                </div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px;">
                ${[
            { label: 'ROI', value: kpis.roi + '%', color: kpis.roi >= 0 ? secondaryColor : '#ff6b6b' },
            { label: 'Ticket MÃ©dio', value: formatCurrency(kpis.avgTicket), color: primaryColor },
            { label: 'Saldo', value: formatCurrency(branch.balance), color: branch.balance > 0 ? secondaryColor : '#ff6b6b' },
            { label: 'Payback', value: kpis.payback + '%', color: '#ffa502' }
        ].map(k => `
                    <div style="padding:12px;background:rgba(255,255,255,0.03);border-radius:8px;text-align:center;">
                        <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;margin-bottom:6px;">${k.label}</div>
                        <div style="font-size:18px;font-weight:700;color:${k.color};">${k.value}</div>
                    </div>`).join('')}
            </div>
            <div style="padding:14px;background:rgba(255,255,255,0.03);border-radius:8px;margin-bottom:16px;">
                <div style="font-weight:700;color:var(--text-primary);margin-bottom:10px;">Resumo</div>
                <div style="font-size:13px;color:var(--text-secondary);display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div><strong>Campanhas:</strong> ${branch.campaigns.length}</div>
                    <div><strong>Vendas:</strong> ${branch.sales.length}</div>
                    <div><strong>Status:</strong> ${health.label}</div>
                    <div><strong>Dias restantes:</strong> ${health.days === Infinity ? 'âˆž' : health.days}</div>
                </div>
            </div>
            <div style="padding:12px;background:rgba(${secondaryRgb},0.08);border-radius:8px;border-left:3px solid ${secondaryColor};text-align:center;">
                <div style="font-size:12px;color:${secondaryColor};font-weight:600;">
                    ${kpis.roi > 0 ? 'âœ… Performance positiva! Mantenha o investimento.' : 'âš ï¸ ROI negativo. Revise as campanhas e estratÃ©gias.'}
                </div>
            </div>
        </div>`;
}

function generateCompanyReport() {
    const company = companies[currentCompanyIdx];
    const totalBalance = company.branches.reduce((s, b) => s + b.balance, 0);
    const totalDaily = company.branches.reduce((s, b) => s + b.campaigns.reduce((ss, c) => ss + c.spend, 0), 0);
    const totalRevenue = company.branches.reduce((s, b) => s + b.sales.reduce((ss, sale) => ss + (sale.totalLTV || 0), 0), 0);
    const roi = totalDaily > 0 ? Math.round(((totalRevenue - totalDaily) / totalDaily) * 100) : 0;
    const primaryColor = whiteLabel.primaryColor || '#00d4ff';
    const secondaryColor = '#1dd1a1';
    const warningColor = '#ffa502';
    const dangerColor = '#ff6b6b';

    return `
        <div style="padding:20px;background:rgba(255,255,255,0.02);border-radius:12px;">
            <div style="text-align:center;margin-bottom:24px;padding-bottom:20px;border-bottom:1px solid rgba(255,255,255,0.1);">
                <div style="font-size:22px;font-weight:800;color:${primaryColor};margin-bottom:6px;">RelatÃ³rio Consolidado</div>
                <div style="font-size:14px;color:var(--text-secondary);">${company.name}</div>
                <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">Gerado em ${new Date().toLocaleDateString('pt-BR')}</div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;">
                ${[
            { label: 'Saldo Total', value: formatCurrency(totalBalance), color: primaryColor },
            { label: 'Gasto DiÃ¡rio', value: formatCurrency(totalDaily), color: warningColor },
            { label: 'Receita Total', value: formatCurrency(totalRevenue), color: secondaryColor },
            { label: 'ROI', value: roi + '%', color: roi >= 0 ? secondaryColor : dangerColor }
        ].map(k => `
                    <div style="padding:14px;background:rgba(255,255,255,0.03);border-radius:8px;text-align:center;">
                        <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;margin-bottom:6px;">${k.label}</div>
                        <div style="font-size:18px;font-weight:700;color:${k.color};">${k.value}</div>
                    </div>`).join('')}
            </div>
            <div style="font-weight:700;color:var(--text-primary);margin-bottom:12px;">Performance por Filial</div>
            ${company.branches.map(branch => {
            const spend = branch.campaigns.reduce((s, c) => s + c.spend, 0);
            const revenue = branch.sales.reduce((s, sale) => s + sale.totalLTV, 0);
            const branchROI = spend > 0 ? Math.round(((revenue - spend) / spend) * 100) : 0;
            return `
                    <div style="padding:12px;background:rgba(255,255,255,0.03);border-radius:8px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <div style="font-weight:600;color:var(--text-primary);">${branch.name}</div>
                            <div style="font-size:12px;color:var(--text-secondary);">${branch.campaigns.length} campanhas Â· ${branch.sales.length} vendas</div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-weight:700;color:${branchROI >= 0 ? secondaryColor : dangerColor};">${branchROI}%</div>
                            <div style="font-size:12px;color:var(--text-secondary);">ROI</div>
                        </div>
                    </div>`;
        }).join('')}
        </div>`;
}

// ============================================================
// RELATÃ“RIO HTML (download)
// ============================================================
function showReportModal(type) {
    const company = companies[currentCompanyIdx];
    const branch = type === 'branch' ? company.branches[currentBranchIdx] : null;
    const name = branch ? branch.name : company.name;
    const primaryColor = whiteLabel.primaryColor || '#00d4ff';
    const secondaryColor = '#1dd1a1';
    const primaryRgb = hexToRgb(primaryColor).join(',');
    const secondaryRgb = hexToRgb(secondaryColor).join(',');

    const reportHTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RelatÃ³rio - ${name}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', Arial, sans-serif; background: linear-gradient(135deg, #0a0e27 0%, #141829 100%); color: #f1f5f9; padding: 40px 20px; }
        .container { max-width: 1000px; margin: 0 auto; }
        .header { text-align: center; margin-bottom: 40px; padding: 40px; background: rgba(255,255,255,0.03); border: 1px solid rgba(${primaryRgb},0.1); border-radius: 12px; }
        .header h1 { background: linear-gradient(135deg, ${primaryColor}, ${secondaryColor}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 10px; font-size: 32px; }
        .header p { color: #94a3b8; margin: 5px 0; }
        .section { margin-bottom: 40px; }
        .section h2 { color: ${primaryColor}; border-left: 4px solid ${primaryColor}; padding-left: 15px; margin-bottom: 20px; font-size: 20px; }
        .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .kpi-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(${primaryRgb},0.1); border-radius: 12px; padding: 20px; }
        .kpi-label { color: #94a3b8; font-size: 12px; text-transform: uppercase; margin-bottom: 8px; }
        .kpi-value { background: linear-gradient(135deg, ${primaryColor}, ${secondaryColor}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: 24px; font-weight: 700; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th { background: rgba(${primaryRgb},0.1); padding: 12px; text-align: left; color: ${primaryColor}; font-size: 12px; text-transform: uppercase; border-bottom: 1px solid rgba(${primaryRgb},0.2); }
        td { padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.08); color: #f1f5f9; }
        tr:hover { background: rgba(${primaryRgb},0.05); }
        .footer { text-align: center; margin-top: 60px; padding: 30px; color: #64748b; font-size: 12px; border-top: 1px solid rgba(255,255,255,0.08); }
    
        .alert-dismiss, .smart-alert button, .toast-close {
            cursor: pointer !important;
            z-index: 100 !important;
            pointer-events: auto !important;
        }
        .smart-alert {
            transition: all 0.3s ease;
        }

    
        
        /* ===== GLASSMORPHISM PREMIUM ===== */
        .card, .kpi-card-advanced, .campaign-card, .modal-content {
            background: var(--glass-bg) !important;
            backdrop-filter: blur(20px) !important;
            border: 1px solid var(--glass-border) !important;
            box-shadow: var(--shadow-md) !important;
        }
        
        .card:hover, .campaign-card:hover {
            border-color: rgba(0, 212, 255, 0.3);
            box-shadow: var(--shadow-lg), var(--shadow-glow-primary);
            transform: translateY(-4px);
        }
        
        /* ===== ANIMAÃ‡Ã•ES PREMIUM ===== */
        
            to { opacity: 1; transform: translateY(0); }
        }
        
        
            to { opacity: 1; transform: translateX(0); }
        }
        
        
            50% { box-shadow: var(--shadow-glow-primary), 0 0 30px rgba(0, 212, 255, 0.25); }
        }
        
        .card { animation: fadeInUp 0.6s cubic-bezier(0.23, 1, 0.32, 1) forwards; }
        .nav-item { animation: slideInRight 0.4s cubic-bezier(0.23, 1, 0.32, 1) forwards; }
        
        /* ===== BOTÃ•ES PREMIUM ===== */
        .btn {
            position: relative;
            overflow: hidden;
            transition: all 0.3s cubic-bezier(0.23, 1, 0.32, 1);
            box-shadow: 0 4px 15px rgba(0, 212, 255, 0.2);
        }
        
        .btn::before {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            width: 0;
            height: 0;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.3);
            transform: translate(-50%, -50%);
            transition: width 0.6s, height 0.6s;
        }
        
        .btn:active::before {
            width: 300px;
            height: 300px;
        }
        
        .btn-primary {
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            box-shadow: 0 8px 24px rgba(0, 212, 255, 0.35);
        }
        
        .btn-primary:hover {
            transform: translateY(-3px);
            box-shadow: 0 12px 36px rgba(0, 212, 255, 0.5);
        }
        
        /* ===== INDICADORES DE SAÃšDE VISUAL ===== */
        .health-indicator {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
        }
        
        .health-indicator.critical {
            background: rgba(255, 107, 107, 0.15);
            color: #ff8787;
            border: 1px solid rgba(255, 107, 107, 0.3);
        }
        
        .health-indicator.warning {
            background: rgba(255, 159, 67, 0.15);
            color: #ffb366;
            border: 1px solid rgba(255, 159, 67, 0.3);
        }
        
        .health-indicator.success {
            background: rgba(29, 209, 161, 0.15);
            color: #4ddbb8;
            border: 1px solid rgba(29, 209, 161, 0.3);
        }
        
        /* ===== BARRA DE PROGRESSO VISUAL ===== */
        .progress-bar-premium {
            height: 6px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 10px;
            overflow: hidden;
            margin-top: 12px;
        }
        
        .progress-fill-premium {
            height: 100%;
            background: linear-gradient(90deg, var(--primary), var(--secondary));
            border-radius: 10px;
            transition: width 0.4s cubic-bezier(0.23, 1, 0.32, 1);
            box-shadow: 0 0 10px rgba(0, 212, 255, 0.5);
        }

    
        
        /* ===== HEALTH SCORE VISUAL ===== */
        .health-score-ring {
            width: 120px;
            height: 120px;
            border-radius: 50%;
            background: conic-gradient(
                var(--primary) 0deg,
                var(--primary) calc(var(--health-score) * 3.6deg),
                rgba(255, 255, 255, 0.05) calc(var(--health-score) * 3.6deg)
            );
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            font-size: 24px;
            font-weight: 800;
            color: var(--text-primary);
            box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.3);
        }
        
        .health-score-ring::before {
            content: '';
            position: absolute;
            width: 100px;
            height: 100px;
            border-radius: 50%;
            background: var(--dark-surface);
            z-index: 1;
        }
        
        .health-score-value {
            position: relative;
            z-index: 2;
        }
        
        /* ===== SPARKLINE CHARTS ===== */
        .sparkline {
            width: 100%;
            height: 30px;
            margin-top: 8px;
        }
        
        /* ===== TOOLTIP PREMIUM ===== */
        .tooltip {
            position: relative;
            display: inline-block;
            cursor: help;
        }
        
        .tooltip .tooltiptext {
            visibility: hidden;
            width: 200px;
            background-color: rgba(20, 24, 41, 0.95);
            color: var(--text-primary);
            text-align: center;
            border-radius: 8px;
            padding: 8px 12px;
            position: absolute;
            z-index: 1000;
            bottom: 125%;
            left: 50%;
            margin-left: -100px;
            opacity: 0;
            transition: opacity 0.3s;
            font-size: 12px;
            border: 1px solid var(--glass-border);
            backdrop-filter: blur(10px);
        }
        
        .tooltip .tooltiptext::after {
            content: '';
            position: absolute;
            top: 100%;
            left: 50%;
            margin-left: -5px;
            border-width: 5px;
            border-style: solid;
            border-color: rgba(20, 24, 41, 0.95) transparent transparent transparent;
        }
        
        .tooltip:hover .tooltiptext {
            visibility: visible;
            opacity: 1;
        }

    
        
        /* ===== BREADCRUMB ANIMADO ===== */
        .breadcrumb {
            animation: slideInRight 0.4s ease;
        }
        
        .breadcrumb-item {
            position: relative;
            transition: all 0.3s ease;
        }
        
        .breadcrumb-item::after {
            content: '';
            position: absolute;
            bottom: -2px;
            left: 0;
            width: 0;
            height: 2px;
            background: var(--primary);
            transition: width 0.3s ease;
        }
        
        .breadcrumb-item:hover::after {
            width: 100%;
        }
        
        /* ===== MODAL PREMIUM ===== */
        .modal {
            animation: fadeInUp 0.4s cubic-bezier(0.23, 1, 0.32, 1);
        }
        
        .modal-overlay {
            backdrop-filter: blur(5px);
            background: rgba(0, 0, 0, 0.4);
        }
        
        .modal-content {
            animation: slideInUp 0.4s cubic-bezier(0.23, 1, 0.32, 1);
        }
        
        
            to { opacity: 1; transform: translateY(0); }
        }

    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>RelatÃ³rio - ${name}</h1>
            <p>${company.name}</p>
            <p>Gerado em ${new Date().toLocaleDateString('pt-BR')} Ã s ${new Date().toLocaleTimeString('pt-BR')}</p>
        </div>
        ${branch ? generateBranchHTMLReport(branch) : generateCompanyHTMLReport(company)}
        <div class="footer">
            <p>RelatÃ³rio gerado pelo TrafficFlow Ultimate</p>
        </div>
    </div>

    <!-- Theme Customizer Panel -->
    <div id="themePanel" style="position: fixed; top: 90px; right: 20px; width: 320px; background: var(--glass-bg); backdrop-filter: blur(20px); border: 1px solid var(--glass-border); border-radius: 16px; padding: 20px; z-index: 5000; box-shadow: var(--shadow-lg); display: none; max-height: 80vh; overflow-y: auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h3 style="margin: 0; font-size: 16px; font-weight: 700;">âš™ï¸ Personalizar Tema</h3>
            <button onclick="closeThemePanel()" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 18px;">
                <i class="fas fa-times"></i>
            </button>
        </div>
        
        <!-- Theme Toggle -->
        <div style="margin-bottom: 20px;">
            <label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 10px; text-transform: uppercase;">Modo</label>
            <div style="display: flex; gap: 10px;">
                <button onclick="setTheme('dark')" id="themeDarkBtn" style="flex: 1; padding: 10px; border: 2px solid var(--primary); background: rgba(0, 212, 255, 0.1); color: var(--primary); border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s;">
                    ðŸŒ™ Escuro
                </button>
                <button onclick="setTheme('light')" id="themeLightBtn" style="flex: 1; padding: 10px; border: 2px solid var(--border); background: transparent; color: var(--text-secondary); border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s;">
                    â˜€ï¸ Claro
                </button>
            </div>
        </div>
        
        <!-- Color Customization -->
        <div style="margin-bottom: 20px;">
            <label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 10px; text-transform: uppercase;">Cor PrimÃ¡ria</label>
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px;">
                <button onclick="setCustomColor('#00d4ff')" style="width: 100%; height: 40px; background: #00d4ff; border: 2px solid transparent; border-radius: 8px; cursor: pointer; transition: all 0.2s;" title="Cyan"></button>
                <button onclick="setCustomColor('#1dd1a1')" style="width: 100%; height: 40px; background: #1dd1a1; border: 2px solid transparent; border-radius: 8px; cursor: pointer; transition: all 0.2s;" title="Green"></button>
                <button onclick="setCustomColor('#a29bfe')" style="width: 100%; height: 40px; background: #a29bfe; border: 2px solid transparent; border-radius: 8px; cursor: pointer; transition: all 0.2s;" title="Purple"></button>
                <button onclick="setCustomColor('#ff6b6b')" style="width: 100%; height: 40px; background: #ff6b6b; border: 2px solid transparent; border-radius: 8px; cursor: pointer; transition: all 0.2s;" title="Red"></button>
                <button onclick="setCustomColor('#f59e0b')" style="width: 100%; height: 40px; background: #f59e0b; border: 2px solid transparent; border-radius: 8px; cursor: pointer; transition: all 0.2s;" title="Amber"></button>
                <button onclick="setCustomColor('#ec4899')" style="width: 100%; height: 40px; background: #ec4899; border: 2px solid transparent; border-radius: 8px; cursor: pointer; transition: all 0.2s;" title="Pink"></button>
                <button onclick="setCustomColor('#06b6d4')" style="width: 100%; height: 40px; background: #06b6d4; border: 2px solid transparent; border-radius: 8px; cursor: pointer; transition: all 0.2s;" title="Cyan"></button>
                <button onclick="setCustomColor('#8b5cf6')" style="width: 100%; height: 40px; background: #8b5cf6; border: 2px solid transparent; border-radius: 8px; cursor: pointer; transition: all 0.2s;" title="Violet"></button>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <input type="color" id="customColorPicker" value="#00d4ff" style="width: 40px; height: 40px; border: none; border-radius: 8px; cursor: pointer; padding: 0;" onchange="setCustomColor(this.value)">
                <span style="font-size: 12px; color: var(--text-tertiary);">Personalizada</span>
            </div>
        </div>
        
        <!-- Contrast -->
        <div style="margin-bottom: 20px;">
            <label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 10px; text-transform: uppercase;">Contraste</label>
            <input type="range" id="contrastSlider" min="80" max="150" value="100" style="width: 100%; cursor: pointer;" onchange="setContrast(this.value)">
            <div style="font-size: 11px; color: var(--text-tertiary); margin-top: 5px; text-align: center;" id="contrastValue">100%</div>
        </div>

        <!-- Reset -->
        <button onclick="resetTheme()" style="width: 100%; padding: 10px; background: rgba(255, 107, 107, 0.1); color: var(--danger); border: 1px solid var(--danger); border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s;">
            â†º Restaurar PadrÃ£o
        </button>
    </div>

    <!-- BotÃ£o Flutuante de Troca de Tema -->
    <button class="theme-floating-btn" id="themeToggleBtn" onclick="toggleTheme()" aria-label="Alternar entre modo escuro e claro" title="Alternar tema">
        <svg class="icon icon-sun" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
        <svg class="icon icon-moon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
    </button>

</body>
</html>`;

    downloadFile(reportHTML, `relatorio_${name}_${new Date().toISOString().split('T')[0]}.html`, 'text/html');
    showToast('success', 'RelatÃ³rio gerado!', `Arquivo HTML baixado com sucesso.`);
    addAuditEntry('RelatÃ³rio HTML gerado', `"${name}"`, 'info');
}

function generateBranchHTMLReport(branch) {
    const kpis = calculateAdvancedKPIs(branch);
    return `
        <div class="section">
            <h2>KPIs Principais</h2>
            <div class="kpi-grid">
                <div class="kpi-card"><div class="kpi-label">ROI</div><div class="kpi-value">${kpis.roi}%</div></div>
                <div class="kpi-card"><div class="kpi-label">Receita Total</div><div class="kpi-value">${formatCurrency(kpis.totalRevenue)}</div></div>
                <div class="kpi-card"><div class="kpi-label">Investimento</div><div class="kpi-value">${formatCurrency(kpis.totalSpend)}</div></div>
                <div class="kpi-card"><div class="kpi-label">Ticket MÃ©dio</div><div class="kpi-value">${formatCurrency(kpis.avgTicket)}</div></div>
            </div>
        </div>
        <div class="section">
            <h2>Campanhas</h2>
            <table><thead><tr><th>Nome</th><th>Objetivo</th><th>Gasto DiÃ¡rio</th></tr></thead>
            <tbody>${branch.campaigns.map(c => `<tr><td>${c.name}</td><td>${c.purpose}</td><td>${formatCurrency(c.spend)}</td></tr>`).join('')}</tbody></table>
        </div>
        <div class="section">
            <h2>Vendas</h2>
            <table><thead><tr><th>Cliente</th><th>Data</th><th>Produto</th><th>Canal</th><th>LTV</th><th>ROI</th></tr></thead>
            <tbody>${branch.sales.map(s => `<tr><td>${s.clientName}</td><td>${new Date(s.date + 'T00:00:00').toLocaleDateString('pt-BR')}</td><td>${s.product || 'â€”'}</td><td>${s.channel || 'â€”'}</td><td>${formatCurrency(s.totalLTV)}</td><td>${s.roi || 0}%</td></tr>`).join('')}</tbody></table>
        </div>`;
}

function generateCompanyHTMLReport(company) {
    return company.branches.map(branch => `
        <div class="section">
            <h2>${branch.name}</h2>
            ${generateBranchHTMLReport(branch)}
        </div>`).join('');
}

// ============================================================
// CONFIGURAÃ‡Ã•ES
// ============================================================
function switchSettingsTab(tab, btn) {
    ['whitelabel', 'dashboard', 'notifications'].forEach(t => {
        const el = document.getElementById('settingsTab' + t.charAt(0).toUpperCase() + t.slice(1));
        if (el) el.classList.toggle('hidden', t !== tab);
    });
    document.querySelectorAll('#settingsModal .tab-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    if (tab === 'dashboard') renderKpiOrderList();
    if (tab === 'notifications') {
        document.getElementById('alertRoiThreshold').value = alertSettings.roiThreshold;
        document.getElementById('alertBudgetThreshold').value = alertSettings.budgetThreshold;
        document.getElementById('alertBalanceDays').value = alertSettings.balanceDays;
    }
}

function renderKpiOrderList() {
    const list = document.getElementById('kpiOrderList');
    const labels = { balance: 'Saldo DisponÃ­vel', roi: 'ROI Total', spend: 'Gasto Total', revenue: 'Receita Total', ticket: 'Ticket MÃ©dio', payback: 'Payback' };

    list.innerHTML = kpiOrder.map((key, i) => {
        const isVisible = visibleKPIs.includes(key);
        return `
        <div class="premium-checkbox ${isVisible ? 'active' : ''}" onclick="toggleKPIVisibility('${key}')" style="margin-bottom:8px; padding:12px 14px; display:flex; align-items:center; gap:12px; border-radius:12px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); cursor:pointer;">
            <div class="premium-checkbox-box">
                <i class="fas fa-check"></i>
            </div>
            <div style="flex:1;">
                <div class="premium-checkbox-label" style="font-size:13px; font-weight:700; color:var(--text-primary);">${labels[key] || key}</div>
                <div class="premium-checkbox-desc" style="font-size:11px; color:var(--text-tertiary);">PosiÃ§Ã£o: ${i + 1}</div>
            </div>
            <div class="drag-handle" style="cursor:grab; padding:8px;" draggable="true" data-key="${key}" ondragstart="handleKpiDragStart(event)">
                <i class="fas fa-grip-vertical" style="color:var(--text-tertiary);"></i>
            </div>
        </div>`;
    }).join('');

    // Re-attach drag events
    const items = list.querySelectorAll('.premium-checkbox');
    items.forEach(item => {
        const handle = item.querySelector('.drag-handle');
        handle.addEventListener('dragstart', handleKpiDragStart);
        item.addEventListener('dragover', handleKpiDragOver);
        item.addEventListener('drop', handleKpiDrop);
        item.addEventListener('dragend', handleKpiDragEnd);
        item.addEventListener('dragenter', handleKpiDragEnter);
        item.addEventListener('dragleave', handleKpiDragLeave);
    });
}

let draggedKpiItem = null;

function handleKpiDragStart(e) {
    draggedKpiItem = this;
    this.style.opacity = '0.5';
    e.dataTransfer.effectAllowed = 'move';
}

function handleKpiDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleKpiDragEnter(e) {
    if (this !== draggedKpiItem) {
        this.style.borderTop = '2px solid var(--primary)';
    }
}

function handleKpiDragLeave(e) {
    this.style.borderTop = '';
}

function handleKpiDrop(e) {
    e.preventDefault();
    if (this !== draggedKpiItem) {
        const list = document.getElementById('kpiOrderList');
        const allItems = Array.from(list.querySelectorAll('.kpi-order-item'));
        const draggedIndex = allItems.indexOf(draggedKpiItem);
        const targetIndex = allItems.indexOf(this);

        if (draggedIndex < targetIndex) {
            this.parentNode.insertBefore(draggedKpiItem, this.nextSibling);
        } else {
            this.parentNode.insertBefore(draggedKpiItem, this);
        }

        // Atualizar o array kpiOrder
        const newOrder = Array.from(list.querySelectorAll('.kpi-order-item')).map(item => item.dataset.key);
        kpiOrder = newOrder;

        // Re-renderizar para atualizar os nÃºmeros
        renderKpiOrderList();
    }
}

function handleKpiDragEnd(e) {
    this.style.opacity = '1';
    document.querySelectorAll('.kpi-order-item').forEach(item => {
        item.style.borderTop = '';
    });
}

function saveKpiOrder() {
    localStorage.setItem('trafficflow_v8_kpiOrder', JSON.stringify(kpiOrder));
    showToast('success', 'Ordem salva!', 'A ordem dos KPIs foi atualizada.');
    renderDashboard(); // Atualizar o dashboard imediatamente
    closeModal('settingsModal');
}

function saveAlertSettings() {
    alertSettings.roiThreshold = parseInt(document.getElementById('alertRoiThreshold').value) || 0;
    alertSettings.budgetThreshold = parseInt(document.getElementById('alertBudgetThreshold').value) || 90;
    alertSettings.balanceDays = parseInt(document.getElementById('alertBalanceDays').value) || 7;
    localStorage.setItem('trafficflow_v8_alertSettings', JSON.stringify(alertSettings));
    showToast('success', 'ConfiguraÃ§Ãµes salvas!', 'Limites de alerta atualizados.');
    closeModal('settingsModal');
}

function saveWhiteLabelSettings() {
    whiteLabel.brandName = document.getElementById('brandName').value || 'TrafficFlow Ultimate';
    whiteLabel.logoUrl = document.getElementById('logoUrl').value || '';
    whiteLabel.primaryColor = document.getElementById('primaryColor').value || '#00d4ff';
    localStorage.setItem('tf_brandName', whiteLabel.brandName);
    localStorage.setItem('tf_logoUrl', whiteLabel.logoUrl);
    localStorage.setItem('tf_primaryColor', whiteLabel.primaryColor);
    document.documentElement.style.setProperty('--primary', whiteLabel.primaryColor);
    updateBrandDisplay();
    showToast('success', 'ConfiguraÃ§Ãµes salvas!', 'White-label atualizado.');
    closeModal('settingsModal');
    addAuditEntry('ConfiguraÃ§Ãµes salvas', `Marca: "${whiteLabel.brandName}"`, 'info');
}

function updateBrandDisplay() {
    document.querySelectorAll('[data-brand-name]').forEach(el => el.textContent = whiteLabel.brandName);
}

// ============================================================
// COMPARTILHAR
// ============================================================
function shareViaWhatsApp() {
    const company = currentCompanyIdx !== null ? companies[currentCompanyIdx] : null;
    const branch = currentBranchIdx !== null && company ? company.branches[currentBranchIdx] : null;
    const name = branch ? branch.name : (company ? company.name : 'TrafficFlow');
    const kpis = branch ? calculateAdvancedKPIs(branch) : null;
    let msg = `ðŸ“Š *RelatÃ³rio TrafficFlow - ${name}*\n`;
    if (kpis) {
        msg += `\nðŸ’° ROI: ${kpis.roi}%\nðŸ“ˆ Receita: ${formatCurrency(kpis.totalRevenue)}\nðŸ’¸ Investimento: ${formatCurrency(kpis.totalSpend)}\nðŸŽ¯ Ticket MÃ©dio: ${formatCurrency(kpis.avgTicket)}`;
    }
    msg += `\n\n_Gerado em ${new Date().toLocaleDateString('pt-BR')}_`;
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
    closeModal('shareModal');
    addAuditEntry('Compartilhado via WhatsApp', name, 'info');
}

function shareViaEmail() {
    const company = currentCompanyIdx !== null ? companies[currentCompanyIdx] : null;
    const branch = currentBranchIdx !== null && company ? company.branches[currentBranchIdx] : null;
    const name = branch ? branch.name : (company ? company.name : 'TrafficFlow');
    window.location.href = `mailto:?subject=${encodeURIComponent('RelatÃ³rio - ' + name)}&body=${encodeURIComponent('Segue o relatÃ³rio de ' + name)}`;
    closeModal('shareModal');
}

// ============================================================
// CALENDÃRIO DE RELATÃ“RIOS
// ============================================================
function openReportPanel() {
    updateSidebarAlt();
    openModal('reportModal');
}

function updateSidebarAlt() {
    updateBranchesList();
    updateCalendarGrid();
    updateReportList();
}

function updateBranchesList() {
    const branchesList = document.getElementById('branchesList');
    if (!branchesList) return;
    let allBranches = [];
    companies.forEach((company, compIdx) => {
        company.branches.forEach((branch, branchIdx) => {
            allBranches.push({ compIdx, branchIdx, name: branch.name, companyName: company.name });
        });
    });
    if (allBranches.length === 0) {
        branchesList.innerHTML = '<div class="no-branches-message">Nenhuma filial cadastrada</div>';
        return;
    }
    branchesList.innerHTML = allBranches.map(branch => {
        const isActive = currentCompanyIdx === branch.compIdx && currentBranchIdx === branch.branchIdx;
        return `<div class="branch-item ${isActive ? 'active' : ''}" onclick="selectBranchFromAlt(${branch.compIdx}, ${branch.branchIdx})" tabindex="0" role="button">
            <div style="font-weight:600;">${branch.name}</div>
            <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${branch.companyName}</div>
        </div>`;
    }).join('');
}

function selectBranchFromAlt(compIdx, branchIdx) {
    currentCompanyIdx = compIdx;
    currentBranchIdx = branchIdx;
    currentView = 'branch';
    updateBreadcrumb();
    renderBranch();
    updateBranchesList();
    closeModal('reportModal');
}

function getReportSchedule() {
    let allBranches = [];
    companies.forEach((company, compIdx) => {
        company.branches.forEach((branch, branchIdx) => {
            allBranches.push({ compIdx, branchIdx, name: branch.name, companyName: company.name });
        });
    });
    const schedule = {};
    const daysOfWeek = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];
    allBranches.forEach((branch, idx) => {
        const day = daysOfWeek[idx % 7];
        if (!schedule[day]) schedule[day] = [];
        schedule[day].push(branch);
    });
    return { schedule, daysOfWeek, allBranches };
}

function updateCalendarGrid() {
    const calendarGrid = document.getElementById('calendarGrid');
    if (!calendarGrid) return;
    const { schedule, daysOfWeek, allBranches } = getReportSchedule();
    if (allBranches.length === 0) {
        calendarGrid.innerHTML = '<div class="no-branches-message" style="grid-column:1/-1;">Cadastre filiais para ver o calendÃ¡rio</div>';
        return;
    }
    const dayNames = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'SÃ¡b', 'Dom'];
    const todayIdx = (new Date().getDay() + 6) % 7;
    calendarGrid.innerHTML = daysOfWeek.map((day, idx) => {
        const branches = schedule[day] || [];
        const allSent = branches.length > 0 && branches.every(b => companies[b.compIdx].branches[b.branchIdx].reportSent);
        const isActive = idx === todayIdx;
        return `
            <div class="calendar-day ${isActive ? 'active-day' : ''}" style="${allSent ? 'border-color:var(--secondary);' : ''}">
                <div class="calendar-day-name">${dayNames[idx]}</div>
                <div class="calendar-day-branches" style="${allSent ? 'color:var(--secondary);' : ''}">
                    ${branches.length > 0 ? (allSent ? '<i class="fas fa-check"></i>' : branches.length) : 'â€”'}
                </div>
            </div>`;
    }).join('');
}

function updateReportList() {
    const reportList = document.getElementById('reportList');
    if (!reportList) return;

    let allStatus = [];
    companies.forEach((company, compIdx) => {
        company.branches.forEach((branch, branchIdx) => {
            allStatus.push({ compIdx, branchIdx, branch, companyName: company.name });
        });
    });

    if (allStatus.length === 0) {
        reportList.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary);">Nenhuma filial para monitorar</div>';
        return;
    }

    reportList.innerHTML = allStatus.map(item => {
        const b = item.branch;
        const leadsSent = b.leadsReportSent;
        const execSent = b.executiveReportSent;
        const lateness = checkReportLatency(b);

        return `
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;">
            <div>
                <div style="font-weight:700;color:var(--text-primary);">${b.name}</div>
                <div style="font-size:11px;color:var(--text-tertiary);">${item.companyName}</div>
                ${lateness.isLate ? `<div style="margin-top:8px;font-size:10px;color:var(--danger);font-weight:700;"><i class="fas fa-exclamation-triangle"></i> FILIAL EM ATRASO: ${lateness.days} dias</div>` : ''}
            </div>
            <div style="display:flex;gap:12px;">
                <div style="text-align:center;">
                    <div style="font-size:9px;color:var(--text-tertiary);text-transform:uppercase;margin-bottom:4px;">1. Leads Filial</div>
                    <button class="btn btn-sm ${leadsSent ? 'btn-success' : 'btn-secondary'}" onclick="toggleReportStatus(${item.compIdx}, ${item.branchIdx}, 'leads')">
                        <i class="fas ${leadsSent ? 'fa-check' : 'fa-clock'}"></i> ${leadsSent ? 'Recebido' : 'Pendente'}
                    </button>
                </div>
                <div style="text-align:center;">
                    <div style="font-size:9px;color:var(--text-tertiary);text-transform:uppercase;margin-bottom:4px;">2. Meu RelatÃ³rio</div>
                    <button class="btn btn-sm ${execSent ? 'btn-primary' : 'btn-secondary'}" onclick="toggleReportStatus(${item.compIdx}, ${item.branchIdx}, 'exec')">
                        <i class="fas ${execSent ? 'fa-paper-plane' : 'fa-clock'}"></i> ${execSent ? 'Enviado' : 'Pendente'}
                    </button>
                </div>
            </div>
        </div>`;
    }).join('');
}

function checkReportLatency(branch) {
    if (!branch.executiveReportSent || !branch.lastExecutiveReportDate) return { isLate: false, days: 0 };
    if (branch.leadsReportSent) return { isLate: false, days: 0 };

    const lastDate = new Date(branch.lastExecutiveReportDate);
    const now = new Date();
    const diffTime = Math.abs(now - lastDate);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    return { isLate: diffDays >= 3, days: diffDays };
}

function runReportAlerts() {
    companies.forEach(company => {
        company.branches.forEach(branch => {
            const lateness = checkReportLatency(branch);
            if (lateness.isLate) {
                addSystemNotification('warning', `Atraso: ${branch.name}`, `Filial nÃ£o enviou leads hÃ¡ ${lateness.days} dias. Recomendamos PAUSAR as campanhas.`);
                addAuditEntry('Alerta de Atraso', `${branch.name}: Recomenda-se pausa de campanha (leads pendentes hÃ¡ ${lateness.days} dias)`, 'warning');
            }
        });
    });
}


function toggleReportStatus(compIdx, branchIdx, type) {
    const branch = companies[compIdx].branches[branchIdx];
    if (type === 'leads') {
        branch.leadsReportSent = !branch.leadsReportSent;
        const status = branch.leadsReportSent ? 'recebido' : 'pendente';
        addAuditEntry('Dados da Filial', `${branch.name}: Leads ${status}`, 'info');
    } else {
        branch.executiveReportSent = !branch.executiveReportSent;
        const status = branch.executiveReportSent ? 'enviado' : 'pendente';
        if (branch.executiveReportSent) {
            branch.lastExecutiveReportDate = new Date().toISOString();
        }
        addAuditEntry('RelatÃ³rio Executivo', `${branch.name}: ${status}`, 'info');
    }
    save();
    updateSidebarAlt();
    updateReportList(); // Atualiza a lista no modal se aberto
}

// ============================================================
// AUDIT LOG - ABRIR
// ============================================================
document.getElementById('auditModal').addEventListener('click', function (e) {
    if (e.target === this) closeModal('auditModal');
});

function openAuditModal() {
    renderAuditLog();
    openModal('auditModal');
}

// ============================================================
// HELPERS
// ============================================================
function getHealthStatus(balance, dailySpend) {
    if (balance <= 0) return { status: 'empty', color: '#1a1a2e', label: 'Esgotado', days: 0, pulse: false };
    const days = dailySpend > 0 ? Math.floor(balance / dailySpend) : Infinity;
    if (days < 3) return { status: 'critical', color: '#ff6b6b', label: 'CRÃTICO', days, pulse: true };
    if (days < alertSettings.balanceDays) return { status: 'warning', color: '#ff9f43', label: 'AtenÃ§Ã£o', days, pulse: false };
    return { status: 'healthy', color: '#1dd1a1', label: 'Seguro', days, pulse: false };
}

function calculateAdvancedKPIs(branch) {
    const campaigns = branch.campaigns || [];
    const sales = branch.sales || [];
    const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
    const totalRevenue = sales.reduce((s, sale) => s + sale.totalLTV, 0);
    const roi = totalSpend > 0 ? Math.round(((totalRevenue - totalSpend) / totalSpend) * 100) : 0;
    const payback = totalSpend > 0 ? Math.round((totalSpend / (totalRevenue || 1)) * 100) : 0;
    const avgTicket = sales.length > 0 ? Math.round(totalRevenue / sales.length) : 0;
    return { roi, payback, avgTicket, totalSpend, totalRevenue };
}

function calculateROI(saleValue, totalCampaignSpend) {
    if (totalCampaignSpend <= 0) return 0;
    return Math.round(((saleValue - totalCampaignSpend) / totalCampaignSpend) * 100);
}

function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

// ============================================================
// RENDER PRINCIPAL
// ============================================================
function render() {
    const contentDiv = document.getElementById('content');
    contentDiv.style.opacity = '0';
    contentDiv.style.transform = 'translateY(8px)';
    setTimeout(() => {
        if (currentView === 'companies') renderCompanies();
        else if (currentView === 'company') renderCompany();
        else if (currentView === 'branch') renderBranch();
        else if (currentView === 'eagle') showEagleDashboard();
        displayAlerts();
        displayInsights();
        updateNotifications();
        updateBrandDisplay();
        displaySmartAlerts();
        setupFormValidation();
        initDatePickers();
        contentDiv.style.transition = 'all 0.35s cubic-bezier(0.23, 1, 0.32, 1)';
        contentDiv.style.opacity = '1';
        contentDiv.style.transform = 'translateY(0)';
    }, 40);
}

// ============================================================
// INICIALIZAÃ‡ÃƒO
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    // Definir data de hoje no modal de venda
    document.getElementById('saleDateInput').value = new Date().toISOString().split('T')[0];

    // Aplicar white-label salvo
    document.documentElement.style.setProperty('--primary', whiteLabel.primaryColor);
    updateBrandDisplay();

    // Preencher configuraÃ§Ãµes salvas
    document.getElementById('brandName').value = whiteLabel.brandName;
    document.getElementById('logoUrl').value = whiteLabel.logoUrl;
    document.getElementById('primaryColor').value = whiteLabel.primaryColor;

    // Atualizar badge de notificaÃ§Ãµes
    updateNotificationBadge();

    // Iniciar Quick Search
    initQuickSearch();

    // Iniciar
    loadUserProfileDisplay();
    goToHome();

    // Migrar dados antigos se existirem
    const oldData = localStorage.getItem('trafficflow_ultimate_companies');
    if (oldData && companies.length === 0) {
        try {
            companies = JSON.parse(oldData);
            // Migrar estrutura de dados
            companies.forEach(company => {
                company.branches.forEach(branch => {
                    if (!branch.campaignGroups) branch.campaignGroups = [];
                    if (branch.budget === undefined) branch.budget = 0;
                    branch.sales.forEach(sale => {
                        if (!sale.product) sale.product = '';
                        if (!sale.channel) sale.channel = '';
                        if (!sale.notes) sale.notes = '';
                    });
                });
            });
            save();
            showToast('info', 'Dados migrados', 'Seus dados foram migrados para a nova versÃ£o.');
        } catch (e) { /* ignore */ }
    }
});


// ============================================================
// PERFIL DO USUÃRIO
// ============================================================
let userProfile = JSON.parse(localStorage.getItem('trafficflow_user_profile')) || {
    name: '',
    role: 'Gestor de TrÃ¡fego',
    avatar: ''
};

function loadUserProfileDisplay() {
    const avatar = document.getElementById('sidebarAvatar');
    const initial = document.getElementById('sidebarAvatarInitial');
    const nameEl = document.getElementById('sidebarUserName');
    const roleEl = document.getElementById('sidebarUserRole');

    if (userProfile.name) {
        if (nameEl) nameEl.textContent = userProfile.name;
    }
    if (userProfile.role && roleEl) {
        roleEl.textContent = userProfile.role;
    }
    if (userProfile.avatar && avatar) {
        if (initial) initial.style.display = 'none';
        // Remove existing img
        const existingImg = avatar.querySelector('img');
        if (existingImg) existingImg.remove();
        const img = document.createElement('img');
        img.src = userProfile.avatar;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        avatar.appendChild(img);
    }
}

function openProfileModal() {
    const nameInput = document.getElementById('profileNameInput');
    const roleInput = document.getElementById('profileRoleInput');
    const avatarLarge = document.getElementById('avatarPreviewLarge');
    const avatarInitial = document.getElementById('avatarPreviewInitial');
    const btnRemove = document.getElementById('btnRemoveAvatar');

    if (nameInput) nameInput.value = userProfile.name || '';
    if (roleInput) roleInput.value = userProfile.role || 'Gestor de TrÃ¡fego';

    // Show current avatar in modal
    if (avatarLarge) {
        const existingImg = avatarLarge.querySelector('img');
        if (existingImg) existingImg.remove();
        if (userProfile.avatar) {
            if (avatarInitial) avatarInitial.style.display = 'none';
            const img = document.createElement('img');
            img.src = userProfile.avatar;
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';
            avatarLarge.appendChild(img);
            if (btnRemove) btnRemove.style.display = 'inline-flex';
        } else {
            const initials = (userProfile.name || whiteLabel.brandName || 'TF').charAt(0).toUpperCase();
            if (avatarInitial) {
                avatarInitial.style.display = 'inline';
                avatarInitial.textContent = initials;
            }
            if (btnRemove) btnRemove.style.display = 'none';
        }
    }

    openModal('profileModal');
}

function handleProfileAvatarUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 500 * 1024) {
        showToast('error', 'Arquivo muito grande', 'A foto deve ter no mÃ¡ximo 500KB.');
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        userProfile.avatar = e.target.result;
        // Update preview in modal
        const avatarLarge = document.getElementById('avatarPreviewLarge');
        const avatarInitial = document.getElementById('avatarPreviewInitial');
        const btnRemove = document.getElementById('btnRemoveAvatar');
        if (avatarLarge) {
            const existingImg = avatarLarge.querySelector('img');
            if (existingImg) existingImg.remove();
            if (avatarInitial) avatarInitial.style.display = 'none';
            const img = document.createElement('img');
            img.src = e.target.result;
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';
            avatarLarge.appendChild(img);
        }
        if (btnRemove) btnRemove.style.display = 'inline-flex';
        showToast('success', 'Foto carregada!', 'Clique em "Salvar Perfil" para confirmar.');
    };
    reader.readAsDataURL(file);
}

function removeProfileAvatar() {
    userProfile.avatar = '';
    const avatarLarge = document.getElementById('avatarPreviewLarge');
    const avatarInitial = document.getElementById('avatarPreviewInitial');
    const btnRemove = document.getElementById('btnRemoveAvatar');
    if (avatarLarge) {
        const existingImg = avatarLarge.querySelector('img');
        if (existingImg) existingImg.remove();
    }
    const initials = (userProfile.name || 'TF').charAt(0).toUpperCase();
    if (avatarInitial) {
        avatarInitial.style.display = 'inline';
        avatarInitial.textContent = initials;
    }
    if (btnRemove) btnRemove.style.display = 'none';

    // Update sidebar
    const sidebarAvatar = document.getElementById('sidebarAvatar');
    const sidebarInitial = document.getElementById('sidebarAvatarInitial');
    if (sidebarAvatar) {
        const existingSidebarImg = sidebarAvatar.querySelector('img');
        if (existingSidebarImg) existingSidebarImg.remove();
        if (sidebarInitial) {
            sidebarInitial.style.display = 'inline';
            sidebarInitial.textContent = initials;
        }
    }
}

function saveUserProfile() {
    const nameInput = document.getElementById('profileNameInput');
    const roleInput = document.getElementById('profileRoleInput');
    if (nameInput) userProfile.name = nameInput.value.trim();
    if (roleInput) userProfile.role = roleInput.value.trim() || 'Gestor de TrÃ¡fego';
    localStorage.setItem('trafficflow_user_profile', JSON.stringify(userProfile));
    loadUserProfileDisplay();
    closeModal('profileModal');
    showToast('success', 'Perfil salvo!', 'Suas informaÃ§Ãµes foram atualizadas.');
}

// ============================================================
// VISÃƒO DE ÃGUIA - DASHBOARD COMPARATIVO
// ============================================================
function showEagleDashboard(selectedCompanyIdx = null) {
    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navEagle = document.getElementById('navEagle');
    if (navEagle) navEagle.classList.add('active');

    currentView = 'eagle';
    const content = document.getElementById('content');

    if (selectedCompanyIdx !== null && companies[selectedCompanyIdx]) {
        const company = companies[selectedCompanyIdx];
        document.getElementById('pageTitle').textContent = `ðŸ¦… Ãguia: ${company.name}`;

        const branchData = company.branches.map((branch, bIdx) => {
            const spend = branch.campaigns.reduce((s, c) => s + (c.spend || 0), 0);
            const revenue = branch.sales.reduce((s, sale) => s + (sale.totalLTV || 0), 0);
            const roi = spend > 0 ? Math.round(((revenue - spend) / spend) * 100) : 0;
            const health = getHealthStatus(branch.balance, spend);
            return { bIdx, name: branch.name, balance: branch.balance, spend, revenue, roi, health, salesCount: branch.sales.length };
        });

        const sortedBranches = [...branchData].sort((a, b) => b.roi - a.roi);
        const topPerformerIdx = sortedBranches[0]?.bIdx;

        let kpiCardsHtml = branchData.map((d) => {
            const rankInSorted = sortedBranches.findIndex(s => s.bIdx === d.bIdx);
            const rankBadge = rankInSorted < 3 ? `<div class="eagle-rank-badge rank-${rankInSorted + 1}">${rankInSorted === 0 ? 'ðŸ¥‡' : rankInSorted === 1 ? 'ðŸ¥ˆ' : 'ðŸ¥‰'} #${rankInSorted + 1} ROI</div>` : '';
            const topBadge = d.bIdx === topPerformerIdx ? '<div class="top-performer-badge">â­ Top</div>' : '';
            const healthColor = d.health.color;

            return `
            <div class="eagle-kpi-card" style="--kpi-color:${healthColor}; cursor:pointer;" onclick="selectBranchFromEagle(${selectedCompanyIdx}, ${d.bIdx})">
                ${topBadge}
                <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:10px;">${d.name}</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
                    <div>
                        <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;">Saldo</div>
                        <div style="font-size:15px;font-weight:700;color:var(--primary);">${formatCurrency(d.balance)}</div>
                    </div>
                    <div>
                        <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;">ROI</div>
                        <div style="font-size:15px;font-weight:700;color:${d.roi >= 0 ? 'var(--secondary)' : 'var(--danger)'};">${d.roi}%</div>
                    </div>
                    <div>
                        <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;">Receita</div>
                        <div style="font-size:13px;font-weight:700;color:var(--text-primary);">${formatCurrency(d.revenue)}</div>
                    </div>
                    <div>
                        <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;">Gasto</div>
                        <div style="font-size:13px;font-weight:700;color:var(--text-primary);">${formatCurrency(d.spend)}</div>
                    </div>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;">
                    <div style="display:flex;align-items:center;gap:6px;">
                        <div class="health-indicator${d.health.pulse ? ' pulse' : ''}" style="background:${healthColor};box-shadow:0 0 6px ${healthColor};"></div>
                        <span style="font-size:11px;color:var(--text-secondary);">${d.health.label}</span>
                    </div>
                    ${rankBadge}
                </div>
            </div>`;
        }).join('');

        content.innerHTML = `
            <div class="eagle-dashboard">
                <div class="eagle-header">
                    <div>
                        <button class="btn btn-secondary btn-sm" onclick="showEagleDashboard()" style="margin-bottom:10px;">
                            <i class="fas fa-arrow-left"></i> Voltar para Empresas
                        </button>
                    </div>
                    <div class="eagle-controls" style="display:flex;gap:10px;">
                        <select id="eagleMetricSelect" class="form-input btn-sm" onchange="renderEagleChart()" style="width:160px; height:auto; padding:6px 12px;">
                            <option value="roi">ROI (%)</option>
                            <option value="balance">Saldo (R$)</option>
                            <option value="revenue">Receita (R$)</option>
                            <option value="spend">Gasto DiÃ¡rio (R$)</option>
                        </select>
                    </div>
                </div>
                <div class="eagle-chart-container" style="height:320px;">
                    <canvas id="eagleChartCanvas"></canvas>
                </div>
                <div class="eagle-kpi-grid">
                    ${kpiCardsHtml}
                </div>
            </div>`;

        window._eagleCompanyData = branchData.map(b => ({
            ...b,
            totalBalance: b.balance,
            totalRevenue: b.revenue,
            totalDaily: b.spend,
            totalSales: b.salesCount
        }));
        setTimeout(() => renderEagleChart(), 100);
        return;
    }

    document.getElementById('pageTitle').textContent = 'ðŸ¦… VisÃ£o de Ãguia';
    const mainBtnText = document.getElementById('mainBtnText');
    if (mainBtnText) mainBtnText.textContent = 'Nova Empresa';
    const mainBtn = document.getElementById('mainBtn');
    if (mainBtn) mainBtn.onclick = () => showAddModal();

    if (companies.length === 0) {
        content.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i class="fas fa-eye"></i></div>
                <div class="empty-state-title">Nenhuma empresa para comparar</div>
                <div class="empty-state-text">Cadastre pelo menos uma empresa para visualizar o dashboard comparativo.</div>
                <button class="btn btn-primary" onclick="goToHome()"><i class="fas fa-building"></i> Ir para Empresas</button>
            </div>`;
        return;
    }

    // Calculate data for all companies
    const companyData = companies.map((company, idx) => {
        const totalBalance = company.branches.reduce((s, b) => s + b.balance, 0);
        const totalDaily = company.branches.reduce((s, b) => s + b.campaigns.reduce((ss, c) => ss + c.spend, 0), 0);
        const totalRevenue = company.branches.reduce((s, b) => s + b.sales.reduce((ss, sale) => ss + (sale.totalLTV || 0), 0), 0);
        const roi = totalDaily > 0 ? Math.round(((totalRevenue - totalDaily) / totalDaily) * 100) : 0;
        const health = getHealthStatus(totalBalance, totalDaily);
        const totalSales = company.branches.reduce((s, b) => s + b.sales.length, 0);
        const avgTicket = totalSales > 0 ? Math.round(totalRevenue / totalSales) : 0;
        return { idx, name: company.name, totalBalance, totalDaily, totalRevenue, roi, health, totalSales, avgTicket };
    });

    // Sort by ROI to find top performer
    const sorted = [...companyData].sort((a, b) => b.roi - a.roi);
    const topPerformerIdx = sorted[0]?.idx;

    // Build HTML
    let kpiCardsHtml = companyData.map((d, rank) => {
        const rankInSorted = sorted.findIndex(s => s.idx === d.idx);
        const rankBadge = rankInSorted < 3 ? `<div class="eagle-rank-badge rank-${rankInSorted + 1}">${rankInSorted === 0 ? 'ðŸ¥‡' : rankInSorted === 1 ? 'ðŸ¥ˆ' : 'ðŸ¥‰'} #${rankInSorted + 1} ROI</div>` : '';
        const topBadge = d.idx === topPerformerIdx ? '<div class="top-performer-badge">â­ Top</div>' : '';
        const healthColor = d.health.color;
        return `
        <div class="eagle-kpi-card" style="--kpi-color:${healthColor}; cursor:pointer;" onclick="showEagleDashboard(${d.idx})">
            ${topBadge}
            <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:10px;">${d.name}</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
                <div>
                    <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;">Saldo</div>
                    <div style="font-size:15px;font-weight:700;color:var(--primary);">${formatCurrency(d.totalBalance)}</div>
                </div>
                <div>
                    <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;">ROI</div>
                    <div style="font-size:15px;font-weight:700;color:${d.roi >= 0 ? 'var(--secondary)' : 'var(--danger)'};">${d.roi}%</div>
                </div>
                <div>
                    <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;">Receita</div>
                    <div style="font-size:13px;font-weight:700;color:var(--text-primary);">${formatCurrency(d.totalRevenue)}</div>
                </div>
                <div>
                    <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;">Vendas</div>
                    <div style="font-size:13px;font-weight:700;color:var(--text-primary);">${d.totalSales}</div>
                </div>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;">
                <div style="display:flex;align-items:center;gap:6px;">
                    <div class="health-indicator${d.health.pulse ? ' pulse' : ''}" style="background:${healthColor};box-shadow:0 0 6px ${healthColor};"></div>
                    <span style="font-size:11px;color:var(--text-secondary);">${d.health.label}</span>
                </div>
                ${rankBadge}
            </div>
        </div>`;
    }).join('');

    content.innerHTML = `
        <div class="eagle-dashboard">
            <div class="eagle-header">
                <div class="eagle-title"><i class="fas fa-eye"></i> VisÃ£o de Ãguia Corporativa</div>
                <div class="eagle-controls" style="display:flex;gap:10px;">
                    <select id="eagleMetricSelect" class="form-input btn-sm" onchange="renderEagleChart()" style="width:160px; height:auto; padding:6px 12px;">
                        <option value="roi">ROI (%)</option>
                        <option value="balance">Saldo Total (R$)</option>
                        <option value="revenue">Receita Total (R$)</option>
                        <option value="spend">Gasto DiÃ¡rio (R$)</option>
                    </select>
            <div style="font-size:14px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:14px;padding-left:12px;border-left:4px solid var(--primary);">
                Portfolio Completo
            </div>
            <div class="eagle-kpi-grid">
                ${kpiCardsHtml}
            </div>
        </div>`;

    // Store company data globally for chart
    window._eagleCompanyData = companyData;
    setTimeout(renderEagleChart, 100);
}

function renderEagleChart() {
    const data = window._eagleCompanyData;
    if (!data || !data.length) return;
    const metricSelect = document.getElementById('eagleMetricSelect');
    const metric = metricSelect ? metricSelect.value : 'roi';
    const canvas = document.getElementById('eagleChartCanvas');
    if (!canvas) return;

    // Destroy existing chart
    if (window._eagleChart) {
        window._eagleChart.destroy();
        window._eagleChart = null;
    }

    const labels = data.map(d => d.name.length > 12 ? d.name.substring(0, 12) + '...' : d.name);
    const values = data.map(d => {
        switch (metric) {
            case 'roi': return d.roi;
            case 'balance': return d.totalBalance;
            case 'revenue': return d.totalRevenue;
            case 'spend': return d.totalDaily;
            case 'sales': return d.totalSales;
            default: return d.roi;
        }
    });

    const backgroundColors = data.map(d => {
        if (d.health.status === 'healthy') return 'rgba(29,209,161,0.7)';
        if (d.health.status === 'warning') return 'rgba(255,159,67,0.7)';
        return 'rgba(255,107,107,0.7)';
    });

    const borderColors = data.map(d => {
        if (d.health.status === 'healthy') return '#1dd1a1';
        if (d.health.status === 'warning') return '#ff9f43';
        return '#ff6b6b';
    });

    const metricLabels = { roi: 'ROI (%)', balance: 'Saldo (R$)', revenue: 'Receita (R$)', spend: 'Gasto DiÃ¡rio (R$)', sales: 'NÂº de Vendas' };

    window._eagleChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: metricLabels[metric] || metric,
                data: values,
                backgroundColor: backgroundColors,
                borderColor: borderColors,
                borderWidth: 2,
                borderRadius: 8,
                borderSkipped: false,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15,23,42,0.95)',
                    titleColor: '#00d4ff',
                    bodyColor: '#94a3b8',
                    borderColor: 'rgba(0,212,255,0.3)',
                    borderWidth: 1,
                    padding: 12,
                    callbacks: {
                        label: (ctx) => {
                            const v = ctx.raw;
                            if (['balance', 'revenue', 'spend'].includes(metric)) {
                                return ' ' + new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
                            }
                            if (metric === 'roi') return ' ' + v + '%';
                            return ' ' + v;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8', font: { size: 11 } }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: {
                        color: '#94a3b8',
                        font: { size: 11 },
                        callback: (v) => {
                            if (['balance', 'revenue', 'spend'].includes(metric)) {
                                return 'R$ ' + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v);
                            }
                            if (metric === 'roi') return v + '%';
                            return v;
                        }
                    }
                }
            },
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const idx = elements[0].index;
                    if (data[idx]) selectCompany(data[idx].idx);
                }
            }
        }
    });
}

// ============================================================
// DISMISS BRANCH ALERTS (Hover Action)
// ============================================================
function dismissBranchAlerts(branchIdx) {
    const company = companies[currentCompanyIdx];
    if (!company || !company.branches[branchIdx]) return;
    const branch = company.branches[branchIdx];
    const alertId = `branch_${currentCompanyIdx}_${branchIdx}`;
    dismissAlert(alertId);
    showToast('info', 'Alerta pausado', `Alertas de "${branch.name}" foram descartados.`);
}

// ============================================================
// STEPS DO MODAL DE VENDA
// ============================================================
let currentSaleStep = 1;

function goToSaleStep(step) {
    // Validate current step before advancing
    if (step > currentSaleStep) {
        if (currentSaleStep === 1) {
            const clientName = document.getElementById('clientNameInput').value.trim();
            if (!clientName || clientName.length < 2) {
                setFieldState('clientNameInput', 'clientNameIcon', 'clientNameError', false, 'Nome deve ter pelo menos 2 caracteres');
                showToast('error', 'AtenÃ§Ã£o', 'Preencha o nome do cliente antes de avanÃ§ar.');
                return;
            }
        }
        if (currentSaleStep === 2) {
            const saleValue = getCurrencyValue(document.getElementById('saleValueInput'));
            if (!saleValue || saleValue <= 0) {
                setFieldState('saleValueInput', 'saleValueIcon', 'saleValueError', false, 'Valor deve ser maior que zero');
                showToast('error', 'AtenÃ§Ã£o', 'Informe o valor da venda antes de avanÃ§ar.');
                return;
            }
            // Populate sale summary
            updateSaleSummary();
        }
    }

    // Update panels
    for (let i = 1; i <= 3; i++) {
        const panel = document.getElementById(`sale-step-panel-${i}`);
        const indicator = document.getElementById(`step-indicator-${i}`);
        if (panel) panel.classList.toggle('active', i === step);
        if (indicator) {
            indicator.classList.remove('active', 'completed');
            if (i === step) indicator.classList.add('active');
            else if (i < step) indicator.classList.add('completed');
        }
    }
    currentSaleStep = step;
}

function updateSaleSummary() {
    const summaryBox = document.getElementById('saleSummaryContent');
    if (!summaryBox) return;
    const clientName = document.getElementById('clientNameInput').value.trim();
    const saleValue = getCurrencyValue(document.getElementById('saleValueInput'));
    const adhesion = getCurrencyValue(document.getElementById('adhesionValueInput'));
    const commission = getCurrencyValue(document.getElementById('commissionValueInput'));
    const date = document.getElementById('saleDateInput').value;
    const product = document.getElementById('saleProductInput').value.trim();
    const channel = document.getElementById('saleChannelInput').value;
    const channelLabels = { google_ads: 'Google Ads', meta_ads: 'Meta Ads', tiktok_ads: 'TikTok Ads', organico: 'OrgÃ¢nico', indicacao: 'IndicaÃ§Ã£o', outro: 'Outro', '': 'NÃ£o informado' };
    let total = saleValue + adhesion;
    if (hasInstallment) {
        const installments = parseInt(document.getElementById('installmentsInput').value) || 0;
        const installVal = getCurrencyValue(document.getElementById('installmentValueInput'));
        total += installments * installVal;
    }
    summaryBox.innerHTML = `
        <div>ðŸ‘¤ <strong>Cliente:</strong> ${clientName}</div>
        ${product ? `<div>ðŸ“¦ <strong>Produto:</strong> ${product}</div>` : ''}
        <div>ðŸ“… <strong>Data:</strong> ${date ? new Date(date + 'T12:00:00').toLocaleDateString('pt-BR') : '-'}</div>
        <div>ðŸ“¢ <strong>Canal:</strong> ${channelLabels[channel] || channel}</div>
        <div>ðŸ’° <strong>Valor venda:</strong> ${formatCurrency(saleValue)}</div>
        ${adhesion > 0 ? `<div>ðŸ”— <strong>AdesÃ£o:</strong> ${formatCurrency(adhesion)}</div>` : ''}
        ${commission > 0 ? `<div>ðŸ¤ <strong>ComissÃ£o:</strong> ${formatCurrency(commission)}</div>` : ''}
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(0,212,255,0.2);font-size:14px;">
            ðŸ’Ž <strong style="color:var(--primary);">LTV Total: ${formatCurrency(total)}</strong>
        </div>`;
}

// ============================================================
// OVERRIDE showSaleModal para resetar steps
// ============================================================
const _originalShowSaleModal = showSaleModal;
window.showSaleModal = function () {
    currentSaleStep = 1;
    goToSaleStep(1);
    _originalShowSaleModal();
}


// NavegaÃ§Ã£o por teclado nos nav-items
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            item.click();
        }
    });
});


// ============================================================
// SISTEMA DE TEMA (LIGHT/DARK MODE)
// ============================================================
let currentTheme = localStorage.getItem('trafficflow_theme') || 'dark';
let customPrimaryColor = localStorage.getItem('trafficflow_primary_color') || '#00d4ff';
let customContrast = localStorage.getItem('trafficflow_contrast') || '100';

function initTheme() {
    document.documentElement.setAttribute('data-theme', currentTheme);
    // Generate harmonious color palette on load
    setCustomColor(customPrimaryColor);
    setContrast(customContrast);
    updateThemeButtons();
}

function setTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('trafficflow_theme', theme);
    updateThemeButtons();
    // Regenerate color palette for new theme
    setCustomColor(customPrimaryColor);
    // NotificaÃ§Ã£o removida para troca de tema
}

// FunÃ§Ã£o para alternar tema via botÃ£o flutuante
function toggleTheme() {
    const btn = document.getElementById('themeToggleBtn');

    // Adicionar efeito ripple
    if (btn) {
        const ripple = document.createElement('span');
        ripple.classList.add('ripple');
        btn.appendChild(ripple);

        // Remover ripple apÃ³s animaÃ§Ã£o
        setTimeout(() => {
            ripple.remove();
        }, 600);
    }

    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
}

function toggleThemePanel() {
    const panel = document.getElementById('themePanel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function closeThemePanel() {
    document.getElementById('themePanel').style.display = 'none';
}

function setCustomColor(color) {
    customPrimaryColor = color;

    // Generate harmonious color palette based on the chosen color
    const palette = generateHarmoniousPalette(color);

    // Apply all color variables
    setCSSVariable('--primary', palette.primary);
    setCSSVariable('--primary-light', palette.primaryLight);
    setCSSVariable('--primary-dark', palette.primaryDark);
    setCSSVariable('--primary-bg', palette.primaryBg);
    setCSSVariable('--primary-surface', palette.primarySurface);
    setCSSVariable('--primary-contrast', palette.contrast);

    localStorage.setItem('trafficflow_primary_color', color);
    updateColorButtons(color);
    showToast('success', 'Cor atualizada', 'Paleta de cores aplicada.');
}

// Generate harmonious color palette
function generateHarmoniousPalette(hexColor) {
    const hsl = hexToHSL(hexColor);
    const isLightMode = document.documentElement.getAttribute('data-theme') === 'light';

    // Calculate optimal lightness based on theme
    const bgLightness = isLightMode ? 95 : 15;
    const surfaceLightness = isLightMode ? 98 : 20;
    const buttonLightness = isLightMode ? 50 : 60;
    const accentLightness = isLightMode ? 40 : 55;

    // Generate primary variations
    const primary = hexColor;
    const primaryLight = hslToHex(hsl.h, hsl.s, buttonLightness);
    const primaryDark = hslToHex(hsl.h, hsl.s, isLightMode ? 35 : 40);
    const primaryBg = hslToHex(hsl.h, Math.max(hsl.s - 30, 10), bgLightness);
    const primarySurface = hslToHex(hsl.h, Math.max(hsl.s - 20, 15), surfaceLightness);

    // Calculate contrast color (white or black based on luminance)
    const luminance = getLuminance(hexColor);
    const contrast = luminance > 0.5 ? '#000000' : '#ffffff';

    return {
        primary,
        primaryLight,
        primaryDark,
        primaryBg,
        primarySurface,
        contrast
    };
}

// Convert HEX to HSL
function hexToHSL(hex) {
    let r = parseInt(hex.slice(1, 3), 16) / 255;
    let g = parseInt(hex.slice(3, 5), 16) / 255;
    let b = parseInt(hex.slice(5, 7), 16) / 255;

    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0;
    } else {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }

    return { h: h * 360, s: s * 100, l: l * 100 };
}

// Convert HSL to HEX
function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;

    let c = (1 - Math.abs(2 * l - 1)) * s;
    let x = c * (1 - Math.abs((h / 60) % 2 - 1));
    let m = l - c / 2;
    let r = 0, g = 0, b = 0;

    if (0 <= h && h < 60) { r = c; g = x; b = 0; }
    else if (60 <= h && h < 120) { r = x; g = c; b = 0; }
    else if (120 <= h && h < 180) { r = 0; g = c; b = x; }
    else if (180 <= h && h < 240) { r = 0; g = x; b = c; }
    else if (240 <= h && h < 300) { r = x; g = 0; b = c; }
    else if (300 <= h && h < 360) { r = c; g = 0; b = x; }

    r = Math.round((r + m) * 255).toString(16).padStart(2, '0');
    g = Math.round((g + m) * 255).toString(16).padStart(2, '0');
    b = Math.round((b + m) * 255).toString(16).padStart(2, '0');

    return '#' + r + g + b;
}

// Calculate luminance
function getLuminance(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;

    const R = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
    const G = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
    const B = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);

    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function setContrast(value) {
    customContrast = value;
    document.documentElement.style.filter = `contrast(${value}%)`;
    document.getElementById('contrastValue').textContent = value + '%';
    localStorage.setItem('trafficflow_contrast', value);
}

function setCSSVariable(name, value) {
    document.documentElement.style.setProperty(name, value);
}

function adjustBrightness(color, percent) {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.min(255, (num >> 16) + amt);
    const G = Math.min(255, (num >> 8 & 0x00FF) + amt);
    const B = Math.min(255, (num & 0x0000FF) + amt);
    return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
}

function updateThemeButtons() {
    const darkBtn = document.getElementById('themeDarkBtn');
    const lightBtn = document.getElementById('themeLightBtn');
    if (currentTheme === 'dark') {
        darkBtn.style.borderColor = 'var(--primary)';
        darkBtn.style.background = 'rgba(0, 212, 255, 0.1)';
        lightBtn.style.borderColor = 'var(--border)';
        lightBtn.style.background = 'transparent';
    } else {
        lightBtn.style.borderColor = 'var(--primary)';
        lightBtn.style.background = 'rgba(0, 212, 255, 0.1)';
        darkBtn.style.borderColor = 'var(--border)';
        darkBtn.style.background = 'transparent';
    }
}

function updateColorButtons(activeColor) {
    document.querySelectorAll('#themePanel button[onclick*="setCustomColor"]').forEach(btn => {
        const btnColor = btn.style.background;
        if (btnColor === activeColor) {
            btn.style.borderColor = 'var(--text-primary)';
            btn.style.borderWidth = '3px';
        } else {
            btn.style.borderColor = 'transparent';
            btn.style.borderWidth = '2px';
        }
    });
}

function resetTheme() {
    setTheme('dark');
    setCustomColor('#00d4ff');
    setContrast('100');
    showToast('info', 'Restaurado', 'ConfiguraÃ§Ãµes de tema restauradas ao padrÃ£o.');
}

// Inicializar tema ao carregar
document.addEventListener('DOMContentLoaded', initTheme);


// --- AUTO DEDUCTION LOGIC ---
function autoDeductDailySpend() {
    const lastDeductionStr = localStorage.getItem('trafficflow_v8_last_deduction');
    const today = new Date();
    today.setHours(0, 0, 0, 0); // start of today

    if (!lastDeductionStr) {
        // First time running this feature, set to today so it starts tracking from tomorrow
        localStorage.setItem('trafficflow_v8_last_deduction', today.getTime().toString());
        return;
    }

    const lastDeduction = new Date(parseInt(lastDeductionStr));
    lastDeduction.setHours(0, 0, 0, 0);

    const diffTime = Math.abs(today - lastDeduction);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 0) {
        let hasChanges = false;
        companies.forEach(company => {
            if (company.branches) {
                company.branches.forEach(branch => {
                    if (branch.campaigns && branch.balance > 0) {
                        const dailySpend = branch.campaigns.reduce((acc, c) => acc + (c.spend || 0), 0);
                        if (dailySpend > 0) {
                            const totalDeduction = dailySpend * diffDays;
                            branch.balance = Math.max(0, branch.balance - totalDeduction);
                            hasChanges = true;
                            // Generate log
                            addAuditEntry(`DeduÃ§Ã£o AutomÃ¡tica`, `${branch.name}: Foram descontados ${formatCurrency(totalDeduction)} referentes a ${diffDays} dias de campanha(s) ativas.`, 'info');
                        }
                    }
                });
            }
        });

        if (hasChanges) {
            save();
            showToast('info', 'Saldo Atualizado', 'Saldos deduzidos automaticamente baseados nas campanhas ativas nos Ãºltimos dias.');
        }
        localStorage.setItem('trafficflow_v8_last_deduction', today.getTime().toString());
    }
}

// Ensure auto-deduction runs on script load
setTimeout(autoDeductDailySpend, 1000);
// -----------------------------
// --- EXPOSE FUNCTIONS TO WINDOW (Fix for "cannot create companies" / Module scope issues) ---
Object.assign(window, {
    goToHome, selectCompany, selectBranch, showAddModal, showEditCompanyModal, showEditBranchModal,
    submitAdd, closeModal, openModal, deleteCompany, deleteCompanyConfirm, deleteBranchConfirm,
    deleteBranchByIdx, showCampaignModal, editCampaign, duplicateCampaign, deleteCampaign,
    showCampaignGroupModal, submitCampaign, submitCampaignGroup, deleteCampaignGroup,
    showSaleModal, editSale, submitSale, deleteSale, openBudgetModal, saveBranchBudget,
    saveBranchBudgetByIdx, openRoiForecastModal, openNotificationsModal, markAllNotificationsRead,
    openAuditModal, openPremiumReport, downloadReportPDF, downloadReportCSV, downloadReportExcel,
    exportData, importData, setFilterPeriod, sortSales, setCampaignPurpose, setHasInstallment,
    goToSaleStep, dismissAlert, dismissBranchAlerts, toggleTheme, toggleThemePanel, closeThemePanel,
    setTheme, setCustomColor, setContrast, resetTheme, openReportPanel, showEagleDashboard,
    switchSettingsTab, saveWhiteLabelSettings, saveKpiOrder, saveAlertSettings, showReportModal,
    filterQuickSearch, navigateToResult, quickAddBalance, handleLogoUpload, validateField1,
    validateCampaignName, validateCampaignSpend, validateSaleField, filterAuditLog, recordDailyMetrics,
    formatCurrency, formatCurrencyInput, getCurrencyValue, getHealthStatus, calculateAdvancedKPIs,
    calculateROI, toggleKPIVisibility, openDashboardCustomizer, saveUserProfile, loadUserProfileDisplay,
    selectBranchFromEagle
});



// Initialize app on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    render();
});

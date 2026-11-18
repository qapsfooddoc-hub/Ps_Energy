// Executive Multi-Year Dashboard Engine & 4 Resource Unit Rate Analytics

let yoyMonthlyChartInstance = null;
let yoyUnitCostChartInstance = null;
let pieChartInstance = null;
let multiYearHistoryChartInstance = null;
let costPerUnitHistoryChartInstance = null;

// Resource Unit Rate Charts
let totalUnitCostTrendChartInstance = null;
let waterUnitChartInstance = null;
let elecUnitChartInstance = null;
let gasUnitChartInstance = null;
let fuelUnitChartInstance = null;

// Resource Cost Per Head Charts (บาท/ตัว)
let waterHeadChartInstance = null;
let elecHeadChartInstance = null;
let gasHeadChartInstance = null;
let fuelHeadChartInstance = null;

function renderDashboard(multiYearData, waterMetersData, elecMetersData) {
    const selectedYear = parseInt(document.getElementById("dash-year-select")?.value) || 2569;
    let compareYear = parseInt(document.getElementById("dash-compare-year-select")?.value) || 2568;
    const selectedMonthFilter = document.getElementById("dash-month-filter")?.value || "ALL";

    const months = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
    
    const curYearData = multiYearData[selectedYear] || multiYearData[String(selectedYear)] || {};
    const cmpYearData = multiYearData[compareYear] || multiYearData[String(compareYear)] || {};

    // 1. Identify active recorded months for Selected Year
    let activeMonthIndices = [];
    let lastActiveMonthName = "";

    months.forEach((m, idx) => {
        // If month filter is set, only match that specific month
        if (selectedMonthFilter !== "ALL" && m !== selectedMonthFilter) return;

        const mData = curYearData[m];
        let hasData = false;
        if (mData) {
            if (mData.production > 0) hasData = true;
            (mData.items || []).forEach(it => {
                if (parseFloat(it.cost) > 0 || parseFloat(it.usage) > 0) hasData = true;
            });
        }
        if (hasData) {
            activeMonthIndices.push(idx);
            lastActiveMonthName = m;
        }
    });

    const isPartialYear = activeMonthIndices.length > 0 && activeMonthIndices.length < 12;

    const ongoingBadge = document.getElementById("ongoing-year-badge");
    if (ongoingBadge) {
        if (selectedMonthFilter !== "ALL") {
            ongoingBadge.style.display = "inline-block";
            ongoingBadge.innerHTML = `<i class="fa-solid fa-filter"></i> กรองเฉพาะเดือน: <strong>${selectedMonthFilter}</strong>`;
        } else if (isPartialYear) {
            ongoingBadge.style.display = "inline-block";
            ongoingBadge.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> ปี ${selectedYear} อยู่ระหว่างดำเนินการ (สรุปข้อมูล ${activeMonthIndices.length} เดือนแรก: ${months[0]} - ${lastActiveMonthName})`;
        } else {
            ongoingBadge.style.display = "none";
        }
    }

    // 2. Process Monthly Data for Selected Year
    let curTotalCost = 0, curTotalProd = 0, curElecCost = 0, curWaterCost = 0, curFuelCost = 0, curGasCost = 0;
    let curMonthlyCosts = [], curMonthlyProds = [], curMonthlyUnitRatios = [];
    let monthlyBreakdowns = [];

    months.forEach((m, idx) => {
        const isRecorded = activeMonthIndices.includes(idx);
        const mData = curYearData[m] || { items: [], production: 0 };
        let mTot = 0, w = 0, e = 0, f = 0, g = 0;

        (mData.items || []).forEach(it => {
            const cost = parseFloat(it.cost) || 0;
            mTot += cost;
            if (it.name.includes("น้ำ") && !it.name.includes("น้ำมัน")) w += cost;
            else if (it.name.includes("ไฟฟ้า")) e += cost;
            else if (it.name.includes("น้ำมัน")) f += cost;
            else if (it.name.includes("แก๊ส") || it.name.includes("LPG")) g += cost;
        });

        const prod = parseFloat(mData.production) || 0;
        const unitRatio = prod > 0 ? mTot / prod : 0;

        monthlyBreakdowns.push({
            month: m,
            isRecorded,
            totalCost: mTot,
            prod,
            unitRatio,
            waterCost: w,
            elecCost: e,
            fuelCost: f,
            gasCost: g
        });

        if (isRecorded) {
            curMonthlyCosts.push(mTot);
            curMonthlyProds.push(prod);
            curMonthlyUnitRatios.push(prod > 0 ? unitRatio : null);

            curTotalCost += mTot;
            curTotalProd += prod;
            curWaterCost += w;
            curElecCost += e;
            curFuelCost += f;
            curGasCost += g;
        } else {
            curMonthlyCosts.push(null);
            curMonthlyProds.push(null);
            curMonthlyUnitRatios.push(null);
        }
    });

    const curAvgUnitCost = curTotalProd > 0 ? (curTotalCost / curTotalProd) : 0;

    // 3. Process Monthly Data for Comparison Year
    let cmpTotalCost = 0, cmpTotalProd = 0, cmpElecCost = 0;
    let cmpMonthlyCosts = [], cmpMonthlyProds = [], cmpMonthlyUnitRatios = [];

    months.forEach((m, idx) => {
        const mData = cmpYearData[m] || { items: [], production: 0 };
        let mTot = 0, e = 0;

        (mData.items || []).forEach(it => {
            const cost = parseFloat(it.cost) || 0;
            mTot += cost;
            if (it.name.includes("ไฟฟ้า")) e += cost;
        });

        const prod = parseFloat(mData.production) || 0;
        cmpMonthlyCosts.push(mTot);
        cmpMonthlyProds.push(prod);
        cmpMonthlyUnitRatios.push(prod > 0 ? mTot / prod : 0);

        if (activeMonthIndices.includes(idx)) {
            cmpTotalCost += mTot;
            cmpTotalProd += prod;
            cmpElecCost += e;
        }
    });

    const cmpAvgUnitCost = cmpTotalProd > 0 ? (cmpTotalCost / cmpTotalProd) : 0;

    // 4. Update Dual Year Side-by-Side KPI Cards & YoY Badges Dynamic Labels
    document.querySelectorAll(".lbl-yr-cur").forEach(el => el.textContent = selectedYear);
    document.querySelectorAll(".lbl-yr-cmp").forEach(el => el.textContent = compareYear);

    document.getElementById("kpi-total-cost").textContent = curTotalCost.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ฿";
    document.getElementById("kpi-total-prod").textContent = curTotalProd.toLocaleString('th-TH') + " ตัว";
    document.getElementById("kpi-avg-cost-unit").textContent = curAvgUnitCost.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ฿/ตัว";
    document.getElementById("kpi-elec-cost").textContent = curElecCost.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ฿";

    document.getElementById("kpi-total-cost-cmp").textContent = cmpTotalCost.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ฿";
    document.getElementById("kpi-total-prod-cmp").textContent = cmpTotalProd.toLocaleString('th-TH') + " ตัว";
    document.getElementById("kpi-avg-cost-unit-cmp").textContent = cmpAvgUnitCost.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ฿/ตัว";
    document.getElementById("kpi-elec-cost-cmp").textContent = cmpElecCost.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ฿";

    const totalYoY = cmpTotalCost > 0 ? ((curTotalCost - cmpTotalCost) / cmpTotalCost * 100) : 0;
    const prodYoY = cmpTotalProd > 0 ? ((curTotalProd - cmpTotalProd) / cmpTotalProd * 100) : 0;
    const unitYoY = cmpAvgUnitCost > 0 ? ((curAvgUnitCost - cmpAvgUnitCost) / cmpAvgUnitCost * 100) : 0;
    const elecYoY = cmpElecCost > 0 ? ((curElecCost - cmpElecCost) / cmpElecCost * 100) : 0;

    const cmpLabelSuffix = selectedMonthFilter !== "ALL" ? ` (${selectedMonthFilter})` : (isPartialYear ? ` (${activeMonthIndices.length} เดือนแรก)` : "");
    updateYoYBadge("kpi-total-yoy", totalYoY, false, compareYear + cmpLabelSuffix);
    updateYoYBadge("kpi-prod-yoy", prodYoY, true, compareYear + cmpLabelSuffix);
    updateYoYBadge("kpi-unit-yoy", unitYoY, false, compareYear + cmpLabelSuffix);
    updateYoYBadge("kpi-elec-yoy", elecYoY, false, compareYear + cmpLabelSuffix);

    ["chart-year-label", "unit-cost-year-label", "pie-year-label", "tbl-year-label"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = selectedYear + cmpLabelSuffix;
    });
    ["chart-compare-label", "unit-cost-cmp-label", "tbl-compare-label"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = compareYear;
    });

    document.querySelectorAll(".tbl-yr-cur").forEach(el => el.textContent = selectedYear);
    document.querySelectorAll(".tbl-yr-cmp").forEach(el => el.textContent = compareYear);

    // 5. Render Automated Executive Insights
    renderExecutiveInsights(monthlyBreakdowns, selectedYear, compareYear, curTotalCost, cmpTotalCost, curAvgUnitCost, cmpAvgUnitCost, curElecCost, curGasCost, curFuelCost, curWaterCost);

    // 6. Render Main Dashboard Charts
    renderMainCharts(months, curMonthlyCosts, cmpMonthlyCosts, curMonthlyUnitRatios, cmpMonthlyUnitRatios, curElecCost, curGasCost, curFuelCost, curWaterCost, selectedYear, compareYear, multiYearData, curMonthlyProds, cmpMonthlyProds);

    // 7. Render Main YoY Table
    renderYoYTable(curMonthlyCosts, cmpMonthlyCosts, curMonthlyProds, cmpMonthlyProds, curMonthlyUnitRatios, cmpMonthlyUnitRatios, activeMonthIndices, isPartialYear, cmpYearData);

    // 8. RENDER 4 RESOURCE UNIT RATE DASHBOARD (บาท/หน่วย - Arrow indicators placed beside current year number)
    renderResourceUnitDashboard(multiYearData, selectedYear, compareYear, months, activeMonthIndices, isPartialYear, curMonthlyUnitRatios, cmpMonthlyUnitRatios, curAvgUnitCost, cmpAvgUnitCost, curMonthlyProds, cmpMonthlyProds);
}

function renderMainCharts(months, curMonthlyCosts, cmpMonthlyCosts, curMonthlyUnitRatios, cmpMonthlyUnitRatios, curElecCost, curGasCost, curFuelCost, curWaterCost, selectedYear, compareYear, multiYearData, curMonthlyProds, cmpMonthlyProds) {
    const ctxYoY = document.getElementById("yoyMonthlyChart")?.getContext("2d");
    if (ctxYoY) {
        if (yoyMonthlyChartInstance) yoyMonthlyChartInstance.destroy();
        yoyMonthlyChartInstance = new Chart(ctxYoY, {
            type: 'line',
            data: {
                labels: months,
                datasets: [
                    { label: `ปี ${selectedYear} (บาท)`, data: curMonthlyCosts, borderColor: '#4f46e5', backgroundColor: 'rgba(79, 70, 229, 0.15)', fill: true, tension: 0.3, borderWidth: 3, pointRadius: 5, spanGaps: false },
                    { label: `ปี ${compareYear} (บาท)`, data: cmpMonthlyCosts, borderColor: '#94a3b8', borderDash: [5, 5], fill: false, tension: 0.3, borderWidth: 2, pointRadius: 4 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: { x: { grid: { color: '#e2e8f0' }, ticks: { color: '#475569', font: { family: 'Niramit', size: 12.5, weight: '600' } } }, y: { grid: { color: '#e2e8f0' }, ticks: { color: '#475569', font: { family: 'Niramit', size: 12.5, weight: '600' }, callback: v => (v / 1000000).toFixed(1) + 'M' } } },
                plugins: { legend: { labels: { color: '#0f172a', font: { family: 'Niramit', size: 13.5, weight: '600' } } } }
            }
        });
    }

    // Monthly Cost Per Head (บาท/ตัว) YoY Trend Line Chart
    renderUnitCostYoYChart("yoyUnitCostChart", yoyUnitCostChartInstance, inst => yoyUnitCostChartInstance = inst, months, curMonthlyUnitRatios, cmpMonthlyUnitRatios, selectedYear, compareYear, curMonthlyProds, cmpMonthlyProds, false);

    const ctxPie = document.getElementById("pieChart")?.getContext("2d");
    if (ctxPie) {
        if (pieChartInstance) pieChartInstance.destroy();
        const curTot = (curElecCost + curGasCost + curFuelCost + curWaterCost) || 1;
        pieChartInstance = new Chart(ctxPie, {
            type: 'doughnut',
            data: {
                labels: [`ไฟฟ้า (${(curElecCost/curTot*100).toFixed(1)}%)`, `แก๊ส LPG (${(curGasCost/curTot*100).toFixed(1)}%)`, `น้ำมัน (${(curFuelCost/curTot*100).toFixed(1)}%)`, `น้ำ (${(curWaterCost/curTot*100).toFixed(1)}%)`],
                datasets: [{ data: [curElecCost, curGasCost, curFuelCost, curWaterCost], backgroundColor: ['#d97706', '#059669', '#e11d48', '#0284c7'], borderWidth: 2, borderColor: '#ffffff' }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#0f172a', font: { family: 'Niramit', size: 13, weight: '600' } } } } }
        });
    }

    const ctxMulti = document.getElementById("multiYearHistoryChart")?.getContext("2d");
    if (ctxMulti) {
        const allYearsList = Object.keys(multiYearData).sort();
        const annualCostsList = allYearsList.map(yr => {
            let yTot = 0;
            const yData = multiYearData[yr] || {};
            months.forEach(m => { (yData[m]?.items || []).forEach(it => yTot += (parseFloat(it.cost) || 0)); });
            return yTot;
        });

        if (multiYearHistoryChartInstance) multiYearHistoryChartInstance.destroy();
        multiYearHistoryChartInstance = new Chart(ctxMulti, {
            type: 'bar',
            data: { labels: allYearsList.map(y => parseInt(y) === selectedYear ? `ปี ${y} (MTD)` : `ปี ${y}`), datasets: [{ label: 'ค่าใช้จ่ายพลังงานรวมรายปี (บาท)', data: annualCostsList, backgroundColor: allYearsList.map(y => parseInt(y) === selectedYear ? '#4f46e5' : 'rgba(148, 163, 184, 0.6)'), borderRadius: 6 }] },
            options: { responsive: true, maintainAspectRatio: false, scales: { x: { grid: { color: '#e2e8f0' }, ticks: { color: '#475569', font: { family: 'Niramit', size: 12, weight: '600' } } }, y: { grid: { color: '#e2e8f0' }, ticks: { color: '#475569', font: { family: 'Niramit', size: 12, weight: '600' }, callback: v => (v / 1000000).toFixed(0) + 'M' } } }, plugins: { legend: { display: false } } }
        });
    }

    const ctxUnitHist = document.getElementById("costPerUnitHistoryChart")?.getContext("2d");
    if (ctxUnitHist) {
        const allYearsList = Object.keys(multiYearData).sort();
        const annualUnitRatios = allYearsList.map(yr => {
            let yTotCost = 0, yTotProd = 0;
            const yData = multiYearData[yr] || {};
            months.forEach(m => { const mData = yData[m] || { items: [], production: 0 }; (mData.items || []).forEach(it => yTotCost += (parseFloat(it.cost) || 0)); yTotProd += (parseFloat(mData.production) || 0); });
            return yTotProd > 0 ? (yTotCost / yTotProd) : 0;
        });

        if (costPerUnitHistoryChartInstance) costPerUnitHistoryChartInstance.destroy();
        costPerUnitHistoryChartInstance = new Chart(ctxUnitHist, {
            type: 'line',
            data: { labels: allYearsList.map(y => parseInt(y) === selectedYear ? `ปี ${y} (MTD)` : `ปี ${y}`), datasets: [{ label: 'ค่าใช้จ่ายพลังงานต่อยอดผลิต (บาท/ตัว)', data: annualUnitRatios, borderColor: '#9333ea', backgroundColor: 'rgba(147, 51, 234, 0.1)', fill: true, tension: 0.3, pointRadius: 5 }] },
            options: { responsive: true, maintainAspectRatio: false, scales: { x: { grid: { color: '#e2e8f0' }, ticks: { color: '#475569', font: { family: 'Niramit', size: 12, weight: '600' } } }, y: { grid: { color: '#e2e8f0' }, ticks: { color: '#475569', font: { family: 'Niramit', size: 12, weight: '600' }, callback: v => v.toFixed(0) + ' ฿' } } }, plugins: { legend: { display: false } } }
        });
    }
}

// ----------------------------------------------------
// RESOURCE UNIT RATE DASHBOARD (บาท/หน่วย)
// ----------------------------------------------------
function renderResourceUnitDashboard(multiYearData, curYear, cmpYear, months, activeMonthIndices, isPartialYear, curMonthlyUnitRatios, cmpMonthlyUnitRatios, curAvgUnitCost, cmpAvgUnitCost, curMonthlyProds, cmpMonthlyProds) {
    const curYearData = multiYearData[curYear] || multiYearData[String(curYear)] || {};
    const cmpYearData = multiYearData[cmpYear] || multiYearData[String(cmpYear)] || {};

    let curWaterUnitRates = [], cmpWaterUnitRates = [];
    let curElecUnitRates = [], cmpElecUnitRates = [];
    let curGasUnitRates = [], cmpGasUnitRates = [];
    let curFuelUnitRates = [], cmpFuelUnitRates = [];

    // Cost Per Head Rates (บาท/ตัว)
    let curWaterHeadRates = [], cmpWaterHeadRates = [];
    let curElecHeadRates = [], cmpElecHeadRates = [];
    let curGasHeadRates = [], cmpGasHeadRates = [];
    let curFuelHeadRates = [], cmpFuelHeadRates = [];

    let sumCurWaterCost = 0, sumCurWaterUsage = 0, sumCmpWaterCost = 0, sumCmpWaterUsage = 0;
    let sumCurElecCost = 0, sumCurElecUsage = 0, sumCmpElecCost = 0, sumCmpElecUsage = 0;
    let sumCurGasCost = 0, sumCurGasUsage = 0, sumCmpGasCost = 0, sumCmpGasUsage = 0;
    let sumCurFuelCost = 0, sumCurFuelUsage = 0, sumCmpFuelCost = 0, sumCmpFuelUsage = 0;
    let sumCurHeadProd = 0, sumCmpHeadProd = 0;

    months.forEach((m, idx) => {
        const isRecorded = !isPartialYear || activeMonthIndices.includes(idx);
        
        // Selected Year Data
        const curM = curYearData[m] || { items: [] };
        let wC = 0, wU = 0, eC = 0, eU = 0, gC = 0, gU = 0, fC = 0, fU = 0;

        (curM.items || []).forEach(it => {
            const cost = parseFloat(it.cost) || 0;
            const usage = parseFloat(it.usage) || 0;
            if (it.name.includes("น้ำ") && !it.name.includes("น้ำมัน")) { wC += cost; wU += usage; }
            else if (it.name.includes("ไฟฟ้า")) { eC += cost; eU += usage; }
            else if (it.name.includes("แก๊ส") || it.name.includes("LPG")) { gC += cost; gU += usage; }
            else if (it.name.includes("น้ำมัน")) { fC += cost; fU += usage; }
        });

        // Comparison Year Data
        const cmpM = cmpYearData[m] || { items: [] };
        let cmpWC = 0, cmpWU = 0, cmpEC = 0, cmpEU = 0, cmpGC = 0, cmpGU = 0, cmpFC = 0, cmpFU = 0;

        (cmpM.items || []).forEach(it => {
            const cost = parseFloat(it.cost) || 0;
            const usage = parseFloat(it.usage) || 0;
            if (it.name.includes("น้ำ") && !it.name.includes("น้ำมัน")) { cmpWC += cost; cmpWU += usage; }
            else if (it.name.includes("ไฟฟ้า")) { cmpEC += cost; cmpEU += usage; }
            else if (it.name.includes("แก๊ส") || it.name.includes("LPG")) { cmpGC += cost; cmpGU += usage; }
            else if (it.name.includes("น้ำมัน")) { cmpFC += cost; cmpFU += usage; }
        });

        const curProd = curMonthlyProds ? curMonthlyProds[idx] : (parseFloat(curM.production) || 0);
        const cmpProd = cmpMonthlyProds ? cmpMonthlyProds[idx] : (parseFloat(cmpM.production) || 0);

        // Unit Rates (บาท/หน่วย)
        const curWRate = wU > 0 ? (wC / wU) : 0;
        const curERate = eU > 0 ? (eC / eU) : 0;
        const curGRate = gU > 0 ? (gC / gU) : 0;
        const curFRate = fU > 0 ? (fC / fU) : 0;

        const cmpWRate = cmpWU > 0 ? (cmpWC / cmpWU) : 0;
        const cmpERate = cmpEU > 0 ? (cmpEC / cmpEU) : 0;
        const cmpGRate = cmpGU > 0 ? (cmpGC / cmpGU) : 0;
        const cmpFRate = cmpFU > 0 ? (cmpFC / cmpFU) : 0;

        // Cost Per Head Rates (บาท/ตัว)
        const curWHead = curProd > 0 ? (wC / curProd) : 0;
        const curEHead = curProd > 0 ? (eC / curProd) : 0;
        const curGHead = curProd > 0 ? (gC / curProd) : 0;
        const curFHead = curProd > 0 ? (fC / curProd) : 0;

        const cmpWHead = cmpProd > 0 ? (cmpWC / cmpProd) : 0;
        const cmpEHead = cmpProd > 0 ? (cmpEC / cmpProd) : 0;
        const cmpGHead = cmpProd > 0 ? (cmpGC / cmpProd) : 0;
        const cmpFHead = cmpProd > 0 ? (cmpFC / cmpProd) : 0;

        cmpWaterUnitRates.push(cmpWRate);
        cmpElecUnitRates.push(cmpERate);
        cmpGasUnitRates.push(cmpGRate);
        cmpFuelUnitRates.push(cmpFRate);

        cmpWaterHeadRates.push(cmpWHead);
        cmpElecHeadRates.push(cmpEHead);
        cmpGasHeadRates.push(cmpGHead);
        cmpFuelHeadRates.push(cmpFHead);

        if (isRecorded) {
            curWaterUnitRates.push(wU > 0 ? curWRate : null);
            curElecUnitRates.push(eU > 0 ? curERate : null);
            curGasUnitRates.push(gU > 0 ? curGRate : null);
            curFuelUnitRates.push(fU > 0 ? curFRate : null);

            curWaterHeadRates.push(curProd > 0 ? curWHead : null);
            curElecHeadRates.push(curProd > 0 ? curEHead : null);
            curGasHeadRates.push(curProd > 0 ? curGHead : null);
            curFuelHeadRates.push(curProd > 0 ? curFHead : null);

            sumCurWaterCost += wC; sumCurWaterUsage += wU;
            sumCurElecCost += eC; sumCurElecUsage += eU;
            sumCurGasCost += gC; sumCurGasUsage += gU;
            sumCurFuelCost += fC; sumCurFuelUsage += fU;
            sumCurHeadProd += curProd;

            sumCmpWaterCost += cmpWC; sumCmpWaterUsage += cmpWU;
            sumCmpElecCost += cmpEC; sumCmpElecUsage += cmpEU;
            sumCmpGasCost += cmpGC; sumCmpGasUsage += cmpGU;
            sumCmpFuelCost += cmpFC; sumCmpFuelUsage += cmpFU;
            sumCmpHeadProd += cmpProd;
        } else {
            curWaterUnitRates.push(null);
            curElecUnitRates.push(null);
            curGasUnitRates.push(null);
            curFuelUnitRates.push(null);

            curWaterHeadRates.push(null);
            curElecHeadRates.push(null);
            curGasHeadRates.push(null);
            curFuelHeadRates.push(null);
        }
    });

    // Calculate Average Unit Rates (บาท/หน่วย)
    const avgCurWater = sumCurWaterUsage > 0 ? (sumCurWaterCost / sumCurWaterUsage) : 0;
    const avgCmpWater = sumCmpWaterUsage > 0 ? (sumCmpWaterCost / sumCmpWaterUsage) : 0;

    const avgCurElec = sumCurElecUsage > 0 ? (sumCurElecCost / sumCurElecUsage) : 0;
    const avgCmpElec = sumCmpElecUsage > 0 ? (sumCmpElecCost / sumCmpElecUsage) : 0;

    const avgCurGas = sumCurGasUsage > 0 ? (sumCurGasCost / sumCurGasUsage) : 0;
    const avgCmpGas = sumCmpGasUsage > 0 ? (sumCmpGasCost / sumCmpGasUsage) : 0;

    const avgCurFuel = sumCurFuelUsage > 0 ? (sumCurFuelCost / sumCurFuelUsage) : 0;
    const avgCmpFuel = sumCmpFuelUsage > 0 ? (sumCmpFuelCost / sumCmpFuelUsage) : 0;

    // Update 4 Unit Rate KPI Cards
    document.getElementById("kpi-unit-water").textContent = avgCurWater.toFixed(2) + " ฿/ลบ.ม.";
    document.getElementById("kpi-unit-elec").textContent = avgCurElec.toFixed(2) + " ฿/kWh";
    document.getElementById("kpi-unit-gas").textContent = avgCurGas.toFixed(2) + " ฿/kg";
    document.getElementById("kpi-unit-fuel").textContent = avgCurFuel.toFixed(2) + " ฿/ลิตร";

    updateYoYBadge("kpi-unit-water-yoy", avgCmpWater > 0 ? ((avgCurWater - avgCmpWater)/avgCmpWater*100) : 0, false, String(cmpYear));
    updateYoYBadge("kpi-unit-elec-yoy", avgCmpElec > 0 ? ((avgCurElec - avgCmpElec)/avgCmpElec*100) : 0, false, String(cmpYear));
    updateYoYBadge("kpi-unit-gas-yoy", avgCmpGas > 0 ? ((avgCurGas - avgCmpGas)/avgCmpGas*100) : 0, false, String(cmpYear));
    updateYoYBadge("kpi-unit-fuel-yoy", avgCmpFuel > 0 ? ((avgCurFuel - avgCmpFuel)/avgCmpFuel*100) : 0, false, String(cmpYear));

    // Calculate Average Cost Per Head (บาท/ตัว)
    const avgCurWHead = sumCurHeadProd > 0 ? (sumCurWaterCost / sumCurHeadProd) : 0;
    const avgCmpWHead = sumCmpHeadProd > 0 ? (sumCmpWaterCost / sumCmpHeadProd) : 0;

    const avgCurEHead = sumCurHeadProd > 0 ? (sumCurElecCost / sumCurHeadProd) : 0;
    const avgCmpEHead = sumCmpHeadProd > 0 ? (sumCmpElecCost / sumCmpHeadProd) : 0;

    const avgCurGHead = sumCurHeadProd > 0 ? (sumCurGasCost / sumCurHeadProd) : 0;
    const avgCmpGHead = sumCmpHeadProd > 0 ? (sumCmpGasCost / sumCmpHeadProd) : 0;

    const avgCurFHead = sumCurHeadProd > 0 ? (sumCurFuelCost / sumCurHeadProd) : 0;
    const avgCmpFHead = sumCmpHeadProd > 0 ? (sumCmpFuelCost / sumCmpHeadProd) : 0;

    // Update 4 Cost Per Head KPI Cards
    const elHW = document.getElementById("kpi-head-water");
    if (elHW) elHW.textContent = avgCurWHead.toFixed(2) + " ฿/ตัว";
    const elHE = document.getElementById("kpi-head-elec");
    if (elHE) elHE.textContent = avgCurEHead.toFixed(2) + " ฿/ตัว";
    const elHG = document.getElementById("kpi-head-gas");
    if (elHG) elHG.textContent = avgCurGHead.toFixed(2) + " ฿/ตัว";
    const elHF = document.getElementById("kpi-head-fuel");
    if (elHF) elHF.textContent = avgCurFHead.toFixed(2) + " ฿/ตัว";

    updateYoYBadge("kpi-head-water-yoy", avgCmpWHead > 0 ? ((avgCurWHead - avgCmpWHead) / avgCmpWHead * 100) : 0, false, String(cmpYear));
    updateYoYBadge("kpi-head-elec-yoy", avgCmpEHead > 0 ? ((avgCurEHead - avgCmpEHead) / avgCmpEHead * 100) : 0, false, String(cmpYear));
    updateYoYBadge("kpi-head-gas-yoy", avgCmpGHead > 0 ? ((avgCurGHead - avgCmpGHead) / avgCmpGHead * 100) : 0, false, String(cmpYear));
    updateYoYBadge("kpi-head-fuel-yoy", avgCmpFHead > 0 ? ((avgCurFHead - avgCmpFHead) / avgCmpFHead * 100) : 0, false, String(cmpYear));

    // Render Master Cost Per Head Trend Chart (บาท/ตัว)
    if (curMonthlyUnitRatios && cmpMonthlyUnitRatios) {
        renderUnitCostYoYChart("totalUnitCostTrendChart", totalUnitCostTrendChartInstance, inst => totalUnitCostTrendChartInstance = inst, months, curMonthlyUnitRatios, cmpMonthlyUnitRatios, curYear, cmpYear, curMonthlyProds, cmpMonthlyProds, false);
        const badge = document.getElementById("overview-unit-cost-badge");
        if (badge) {
            const diff = (curAvgUnitCost && cmpAvgUnitCost) ? (curAvgUnitCost - cmpAvgUnitCost) : 0;
            const diffPct = cmpAvgUnitCost > 0 ? (diff / cmpAvgUnitCost * 100) : 0;
            const sign = diff > 0 ? "+" : "";
            const color = diff > 0 ? "#e11d48" : (diff < 0 ? "#15803d" : "#64748b");
            badge.innerHTML = `เฉลี่ยทั้งปี ${curYear}: <strong>${curAvgUnitCost.toFixed(2)} ฿/ตัว</strong> <span style="color:${color}; font-size:0.85rem; margin-left:6px;">(${sign}${diffPct.toFixed(1)}% vs ${cmpYear})</span>`;
        }

        // Render Monthly Production Summary Strip Under Master Chart
        renderProductionSummaryStrip(curYear, cmpYear, months, curMonthlyProds, cmpMonthlyProds);
    }

    // Render 4 Unit Rate Trend Line Charts (บาท/หน่วย)
    renderUnitLineChart("waterUnitChart", waterUnitChartInstance, inst => waterUnitChartInstance = inst, months, curWaterUnitRates, cmpWaterUnitRates, curYear, cmpYear, '#0284c7', 'ราคาค่าน้ำ (บาท/ลบ.ม.)');
    renderUnitLineChart("elecUnitChart", elecUnitChartInstance, inst => elecUnitChartInstance = inst, months, curElecUnitRates, cmpElecUnitRates, curYear, cmpYear, '#d97706', 'ราคาค่าไฟ (บาท/kWh)');
    renderUnitLineChart("gasUnitChart", gasUnitChartInstance, inst => gasUnitChartInstance = inst, months, curGasUnitRates, cmpGasUnitRates, curYear, cmpYear, '#059669', 'ราคาแก๊ส LPG (บาท/kg)');
    renderUnitLineChart("fuelUnitChart", fuelUnitChartInstance, inst => fuelUnitChartInstance = inst, months, curFuelUnitRates, cmpFuelUnitRates, curYear, cmpYear, '#e11d48', 'ราคาน้ำมัน (บาท/ลิตร)');

    // Render Paired Columns Table (ราคาต่อหน่วย)
    renderResourceUnitTable(months, curWaterUnitRates, cmpWaterUnitRates, curElecUnitRates, cmpElecUnitRates, curGasUnitRates, cmpGasUnitRates, curFuelUnitRates, cmpFuelUnitRates, activeMonthIndices, isPartialYear);

    // Render 4 Cost Per Head Line Charts (บาท/ตัว)
    renderHeadLineChart("waterHeadChart", waterHeadChartInstance, inst => waterHeadChartInstance = inst, months, curWaterHeadRates, cmpWaterHeadRates, curYear, cmpYear, '#0284c7', 'ค่าน้ำ (บาท/ตัว)');
    renderHeadLineChart("elecHeadChart", elecHeadChartInstance, inst => elecHeadChartInstance = inst, months, curElecHeadRates, cmpElecHeadRates, curYear, cmpYear, '#d97706', 'ค่าไฟ (บาท/ตัว)');
    renderHeadLineChart("gasHeadChart", gasHeadChartInstance, inst => gasHeadChartInstance = inst, months, curGasHeadRates, cmpGasHeadRates, curYear, cmpYear, '#059669', 'ค่าแก๊ส LPG (บาท/ตัว)');
    renderHeadLineChart("fuelHeadChart", fuelHeadChartInstance, inst => fuelHeadChartInstance = inst, months, curFuelHeadRates, cmpFuelHeadRates, curYear, cmpYear, '#e11d48', 'ค่าน้ำมัน (บาท/ตัว)');

    // Render Paired Columns Table (ค่าใช้จ่ายต่อตัว บาท/ตัว)
    renderHeadCostTable(months, curWaterHeadRates, cmpWaterHeadRates, curElecHeadRates, cmpElecHeadRates, curGasHeadRates, cmpGasHeadRates, curFuelHeadRates, cmpFuelHeadRates, activeMonthIndices, isPartialYear);
}

// Render Monthly Cost Per Head YoY Chart (บาท/ตัว)
function renderUnitCostYoYChart(canvasId, currentChartInst, setChartInst, months, curRates, cmpRates, curYear, cmpYear, curProds = null, cmpProds = null, showProdLabels = false) {
    const ctx = document.getElementById(canvasId)?.getContext("2d");
    if (!ctx) return;

    if (currentChartInst) currentChartInst.destroy();

    const validRates = [...(curRates || []), ...(cmpRates || [])].filter(r => r !== null && r !== undefined && !isNaN(r) && r > 0);
    let minVal = validRates.length > 0 ? Math.max(0, Math.floor(Math.min(...validRates) / 50) * 50 - 50) : 0;
    let maxVal = validRates.length > 0 ? Math.ceil(Math.max(...validRates) / 50) * 50 + 50 : 600;

    // Build multi-line labels if showProdLabels is true
    const chartLabels = (showProdLabels && curProds && cmpProds)
        ? months.map((m, idx) => {
            const curP = (curProds[idx] !== null && curProds[idx] !== undefined && curProds[idx] > 0)
                ? `${curProds[idx].toLocaleString('th-TH')} ตัว`
                : '-';
            const cmpP = (cmpProds[idx] !== null && cmpProds[idx] !== undefined && cmpProds[idx] > 0)
                ? `${cmpProds[idx].toLocaleString('th-TH')} ตัว`
                : '-';
            return [
                m,
                `ปี ${curYear}: ${curP}`,
                `ปี ${cmpYear}: ${cmpP}`
            ];
        })
        : months;

    const newInst = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartLabels,
            datasets: [
                {
                    label: `ปี ${curYear} (บาท/ตัว)`,
                    data: curRates,
                    borderColor: '#9333ea',
                    backgroundColor: 'rgba(147, 51, 234, 0.15)',
                    fill: true,
                    tension: 0.3,
                    borderWidth: 3,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    spanGaps: false
                },
                {
                    label: `ปี ${cmpYear} (บาท/ตัว)`,
                    data: cmpRates,
                    borderColor: '#64748b',
                    borderDash: [5, 5],
                    fill: false,
                    tension: 0.3,
                    borderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    grid: { color: '#e2e8f0' },
                    ticks: {
                        autoSkip: false,
                        maxRotation: 0,
                        minRotation: 0,
                        color: '#334155',
                        font: { family: 'Niramit', size: showProdLabels ? 11.5 : 12.5, weight: '600' },
                        padding: 6
                    }
                },
                y: {
                    min: minVal,
                    max: maxVal,
                    grid: { color: '#e2e8f0' },
                    ticks: {
                        color: '#475569',
                        font: { family: 'Niramit', size: 12.5, weight: '600' },
                        stepSize: 50,
                        callback: function(value) {
                            return Math.round(value) + ' ฿/ตัว';
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    labels: { color: '#0f172a', font: { family: 'Niramit', size: 13, weight: '600' } }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const val = context.parsed.y;
                            if (val === null || val === undefined) return '';
                            const idx = context.dataIndex;
                            let prodText = '';
                            if (context.datasetIndex === 0 && curProds && curProds[idx]) {
                                prodText = ` (ยอดผลิต ${curProds[idx].toLocaleString('th-TH')} ตัว)`;
                            } else if (context.datasetIndex === 1 && cmpProds && cmpProds[idx]) {
                                prodText = ` (ยอดผลิต ${cmpProds[idx].toLocaleString('th-TH')} ตัว)`;
                            }
                            return `${context.dataset.label}: ${val.toFixed(2)} บาท/ตัว${prodText}`;
                        }
                    }
                }
            }
        }
    });
    setChartInst(newInst);
}

// Render Monthly Pig Production Comparison Strip (under master chart)
function renderProductionSummaryStrip(curYear, cmpYear, months, curProds, cmpProds) {
    const container = document.getElementById("unit-cost-prod-strip");
    if (!container || !curProds || !cmpProds) return;

    const shortMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    let sumCur = 0, sumCmp = 0;
    curProds.forEach(p => { if (p) sumCur += p; });
    cmpProds.forEach(p => { if (p) sumCmp += p; });

    let curTds = "", cmpTds = "", diffTds = "";
    shortMonths.forEach((sm, i) => {
        const cp = curProds[i];
        const kp = cmpProds[i];
        
        curTds += `<td style="padding: 6px 4px; font-weight:700; color:#9333ea;">${cp > 0 ? cp.toLocaleString('th-TH') : '<span style="color:#94a3b8;">-</span>'}</td>`;
        cmpTds += `<td style="padding: 6px 4px; color:#475569;">${kp > 0 ? kp.toLocaleString('th-TH') : '<span style="color:#94a3b8;">-</span>'}</td>`;
        
        if (cp > 0 && kp > 0) {
            const diff = cp - kp;
            const sign = diff > 0 ? '+' : '';
            const color = diff >= 0 ? '#15803d' : '#e11d48';
            diffTds += `<td style="padding: 4px; font-size:0.8rem; font-weight:600; color:${color};">${sign}${diff.toLocaleString('th-TH')}</td>`;
        } else {
            diffTds += `<td style="padding: 4px; font-size:0.8rem; color:#94a3b8;">-</td>`;
        }
    });

    const diffSum = sumCur - sumCmp;
    const diffSumSign = diffSum > 0 ? '+' : '';
    const diffSumColor = diffSum >= 0 ? '#15803d' : '#e11d48';

    container.innerHTML = `
      <div style="font-size: 0.9rem; font-weight: 700; color: #475569; margin-bottom: 0.4rem; display: flex; align-items: center; justify-content: space-between;">
        <span><i class="fa-solid fa-piggy-bank" style="color: #9333ea; margin-right: 6px;"></i> สรุปจำนวนยอดผลิตหมูรายเดือน (ตัว) เปรียบเทียบ</span>
        <span style="font-size: 0.8rem; font-weight: 500; color: #64748b;">(หน่วย: ตัว)</span>
      </div>
      <table style="width: 100%; border-collapse: collapse; text-align: center; font-size: 0.86rem; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;">
        <thead>
          <tr style="background: #f8fafc; color: #475569; font-weight: 700; border-bottom: 1px solid #e2e8f0;">
            <th style="text-align: left; padding: 7px 10px; width: 130px;">ปี / เดือน</th>
            ${shortMonths.map(m => `<th style="padding: 7px 4px;">${m}</th>`).join('')}
            <th style="background: #f1f5f9; padding: 7px 8px; width: 110px;">รวม</th>
          </tr>
        </thead>
        <tbody>
          <tr style="background: #faf5ff; border-bottom: 1px solid #f1f5f9;">
            <td style="text-align: left; padding: 7px 10px; font-weight: 700; color: #9333ea;">
              <span style="display:inline-block; width:8px; height:8px; background:#9333ea; border-radius:50%; margin-right:6px;"></span>ปี ${curYear}
            </td>
            ${curTds}
            <td style="font-weight: 700; color: #9333ea; background: #f3e8ff;">${sumCur.toLocaleString('th-TH')} ตัว</td>
          </tr>
          <tr style="background: #ffffff; border-bottom: 1px solid #f1f5f9;">
            <td style="text-align: left; padding: 7px 10px; font-weight: 600; color: #64748b;">
              <span style="display:inline-block; width:8px; height:8px; background:#64748b; border-radius:50%; margin-right:6px;"></span>ปี ${cmpYear}
            </td>
            ${cmpTds}
            <td style="font-weight: 600; color: #64748b; background: #f8fafc;">${sumCmp.toLocaleString('th-TH')} ตัว</td>
          </tr>
          <tr style="background: #f8fafc;">
            <td style="text-align: left; padding: 5px 10px; font-size: 0.8rem; color: #64748b; font-weight: 600;">ผลต่าง YoY</td>
            ${diffTds}
            <td style="font-weight: 700; font-size: 0.82rem; background: #e2e8f0; color: ${diffSumColor};">
              ${diffSumSign}${diffSum.toLocaleString('th-TH')}
            </td>
          </tr>
        </tbody>
      </table>
    `;
}

// Render Unit Line Chart with 1 Baht Y-Axis Step Size
function renderUnitLineChart(canvasId, currentChartInst, setChartInst, months, curRates, cmpRates, curYear, cmpYear, mainColor, labelText) {
    const ctx = document.getElementById(canvasId)?.getContext("2d");
    if (!ctx) return;

    if (currentChartInst) currentChartInst.destroy();

    const validRates = [...curRates, ...cmpRates].filter(r => r !== null && r !== undefined && !isNaN(r) && r > 0);
    let minVal = validRates.length > 0 ? Math.floor(Math.min(...validRates)) - 1 : 0;
    let maxVal = validRates.length > 0 ? Math.ceil(Math.max(...validRates)) + 1 : 10;
    if (minVal < 0) minVal = 0;

    const newInst = new Chart(ctx, {
        type: 'line',
        data: {
            labels: months,
            datasets: [
                { label: `ปี ${curYear} (${labelText})`, data: curRates, borderColor: mainColor, backgroundColor: mainColor + '1a', fill: true, tension: 0.3, borderWidth: 3, pointRadius: 5, spanGaps: false },
                { label: `ปี ${cmpYear} (${labelText})`, data: cmpRates, borderColor: '#94a3b8', borderDash: [5, 5], fill: false, tension: 0.3, borderWidth: 2, pointRadius: 4 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                x: { grid: { color: '#e2e8f0' }, ticks: { color: '#475569', font: { family: 'Niramit', size: 12.5, weight: '600' } } },
                y: {
                    min: minVal,
                    max: maxVal,
                    grid: { color: '#e2e8f0' },
                    ticks: {
                        color: '#475569',
                        font: { family: 'Niramit', size: 12.5, weight: '600' },
                        stepSize: 1,
                        callback: function(value) {
                            return Math.round(value) + ' ฿';
                        }
                    }
                }
            },
            plugins: { legend: { labels: { color: '#0f172a', font: { family: 'Niramit', size: 13, weight: '600' } } } }
        }
    });
    setChartInst(newInst);
}

// Render Paired Columns Table (2569 vs 2568) with Arrow Indicator right next to Current Year Number
function renderResourceUnitTable(months, curW, cmpW, curE, cmpE, curG, cmpG, curF, cmpF, activeMonthIndices, isPartialYear) {
    const tbody = document.getElementById("unit-rate-table-body");
    if (!tbody) return;

    let html = "";

    // Helper: Returns Arrow icon placed right beside the current year number
    function getArrowIcon(curVal, cmpVal) {
        if (!curVal || !cmpVal || curVal === 0 || cmpVal === 0) return "";
        const diff = curVal - cmpVal;
        if (diff > 0) {
            return `<i class="fa-solid fa-arrow-up" style="color:#e11d48; font-size:0.8rem; margin-left:4px;" title="ราคาต่อหน่วยสูงขึ้น"></i>`;
        } else if (diff < 0) {
            return `<i class="fa-solid fa-arrow-down" style="color:#15803d; font-size:0.8rem; margin-left:4px;" title="ราคาต่อหน่วยถูกลง"></i>`;
        }
        return "";
    }

    // Helper: Returns Clean % Change Badge for the Change Column
    function getPctBadge(curVal, cmpVal) {
        if (curVal === null || curVal === undefined || curVal === 0) return `<span style="color:var(--text-muted);">0.0%</span>`;
        if (cmpVal === 0 || !cmpVal) return `<span style="color:var(--text-muted);">-</span>`;

        const diff = curVal - cmpVal;
        const pct = (diff / cmpVal) * 100;

        if (pct > 0) {
            return `<span style="color:#e11d48; font-weight:700;">+${pct.toFixed(1)}%</span>`;
        } else if (pct < 0) {
            return `<span style="color:#15803d; font-weight:700;">${pct.toFixed(1)}%</span>`;
        } else {
            return `<span style="color:var(--text-muted);">0.0%</span>`;
        }
    }

    months.forEach((m, idx) => {
        const isRecorded = !isPartialYear || activeMonthIndices.includes(idx);
        
        const w = curW[idx];
        const wCmp = cmpW[idx] || 0;

        const e = curE[idx];
        const eCmp = cmpE[idx] || 0;

        const g = curG[idx];
        const gCmp = cmpG[idx] || 0;

        const f = curF[idx];
        const fCmp = cmpF[idx] || 0;

        if (isRecorded && w !== null) {
            html += `
            <tr style="text-align:center;">
                <td class="freeze-col" style="text-align:left;"><strong>${m}</strong></td>
                
                <!-- Water Paired Columns -->
                <td style="font-weight:700; color:var(--color-water); background:#f0f9ff;">${w ? w.toFixed(2) : '0.00'} ฿ ${getArrowIcon(w, wCmp)}</td>
                <td style="color:var(--text-secondary); background:#f0f9ff;">${wCmp ? wCmp.toFixed(2) : '0.00'} ฿</td>
                <td style="background:#f0f9ff;">${getPctBadge(w, wCmp)}</td>

                <!-- Elec Paired Columns -->
                <td style="font-weight:700; color:var(--color-elec); background:#fffbeb;">${e ? e.toFixed(2) : '0.00'} ฿ ${getArrowIcon(e, eCmp)}</td>
                <td style="color:var(--text-secondary); background:#fffbeb;">${eCmp ? eCmp.toFixed(2) : '0.00'} ฿</td>
                <td style="background:#fffbeb;">${getPctBadge(e, eCmp)}</td>

                <!-- Gas Paired Columns -->
                <td style="font-weight:700; color:var(--color-gas); background:#ecfdf5;">${g ? g.toFixed(2) : '0.00'} ฿ ${getArrowIcon(g, gCmp)}</td>
                <td style="color:var(--text-secondary); background:#ecfdf5;">${gCmp ? gCmp.toFixed(2) : '0.00'} ฿</td>
                <td style="background:#ecfdf5;">${getPctBadge(g, gCmp)}</td>

                <!-- Fuel Paired Columns -->
                <td style="font-weight:700; color:var(--color-fuel); background:#fff1f2;">${f ? f.toFixed(2) : '0.00'} ฿ ${getArrowIcon(f, fCmp)}</td>
                <td style="color:var(--text-secondary); background:#fff1f2;">${fCmp ? fCmp.toFixed(2) : '0.00'} ฿</td>
                <td style="background:#fff1f2;">${getPctBadge(f, fCmp)}</td>
            </tr>`;
        } else {
            html += `
            <tr class="unrecorded-row" style="opacity:0.65; background:#f8fafc; text-align:center;">
                <td class="freeze-col" style="text-align:left;"><strong>${m}</strong></td>
                <td>0.00 ฿</td><td>${wCmp ? wCmp.toFixed(2) : '0.00'} ฿</td><td>0.0%</td>
                <td>0.00 ฿</td><td>${eCmp ? eCmp.toFixed(2) : '0.00'} ฿</td><td>0.0%</td>
                <td>0.00 ฿</td><td>${gCmp ? gCmp.toFixed(2) : '0.00'} ฿</td><td>0.0%</td>
                <td>0.00 ฿</td><td>${fCmp ? fCmp.toFixed(2) : '0.00'} ฿</td><td>0.0%</td>
            </tr>`;
        }
    });

    tbody.innerHTML = html;
}

// Render Cost Per Head Line Chart (บาท/ตัว)
function renderHeadLineChart(canvasId, currentChartInst, setChartInst, months, curRates, cmpRates, curYear, cmpYear, mainColor, labelText) {
    const ctx = document.getElementById(canvasId)?.getContext("2d");
    if (!ctx) return;

    if (currentChartInst) currentChartInst.destroy();

    const validRates = [...curRates, ...cmpRates].filter(r => r !== null && r !== undefined && !isNaN(r) && r > 0);
    let minVal = 0;
    let maxVal = 100;
    let stepSize = undefined;

    if (validRates.length > 0) {
        const rawMin = Math.min(...validRates);
        const rawMax = Math.max(...validRates);
        
        if (rawMax > 150) {
            minVal = Math.max(0, Math.floor(rawMin / 50) * 50 - 50);
            maxVal = Math.ceil(rawMax / 50) * 50 + 50;
            stepSize = 50;
        } else if (rawMax > 40) {
            minVal = Math.max(0, Math.floor(rawMin / 10) * 10 - 10);
            maxVal = Math.ceil(rawMax / 10) * 10 + 10;
            stepSize = 10;
        } else {
            minVal = Math.max(0, Math.floor(rawMin / 5) * 5 - 5);
            maxVal = Math.ceil(rawMax / 5) * 5 + 5;
            stepSize = 5;
        }
    }

    const newInst = new Chart(ctx, {
        type: 'line',
        data: {
            labels: months,
            datasets: [
                { 
                    label: `ปี ${curYear} (${labelText})`, 
                    data: curRates, 
                    borderColor: mainColor, 
                    backgroundColor: mainColor + '1a', 
                    fill: true, 
                    tension: 0.3, 
                    borderWidth: 3, 
                    pointRadius: 5, 
                    spanGaps: false 
                },
                { 
                    label: `ปี ${cmpYear} (${labelText})`, 
                    data: cmpRates, 
                    borderColor: '#94a3b8', 
                    borderDash: [5, 5], 
                    fill: false, 
                    tension: 0.3, 
                    borderWidth: 2, 
                    pointRadius: 4 
                }
            ]
        },
        options: {
            responsive: true, 
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: { 
                    grid: { color: '#e2e8f0' }, 
                    ticks: { color: '#475569', font: { family: 'Niramit', size: 12.5, weight: '600' } } 
                },
                y: {
                    min: minVal,
                    max: maxVal,
                    grid: { color: '#e2e8f0' },
                    ticks: {
                        color: '#475569',
                        font: { family: 'Niramit', size: 12.5, weight: '600' },
                        stepSize: stepSize,
                        callback: function(value) {
                            return Math.round(value) + ' ฿/ตัว';
                        }
                    }
                }
            },
            plugins: { 
                legend: { 
                    labels: { color: '#0f172a', font: { family: 'Niramit', size: 13, weight: '600' } } 
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const val = context.parsed.y;
                            if (val === null || val === undefined) return '';
                            return `${context.dataset.label}: ${val.toFixed(2)} บาท/ตัว`;
                        }
                    }
                }
            }
        }
    });
    setChartInst(newInst);
}

// Render Paired Columns Table (ค่าใช้จ่ายต่อตัว บาท/ตัว) with Arrow Indicator right next to Current Year Number
function renderHeadCostTable(months, curW, cmpW, curE, cmpE, curG, cmpG, curF, cmpF, activeMonthIndices, isPartialYear) {
    const tbody = document.getElementById("head-cost-table-body");
    if (!tbody) return;

    let html = "";

    function getArrowIcon(curVal, cmpVal) {
        if (!curVal || !cmpVal || curVal === 0 || cmpVal === 0) return "";
        const diff = curVal - cmpVal;
        if (diff > 0) {
            return `<i class="fa-solid fa-arrow-up" style="color:#e11d48; font-size:0.8rem; margin-left:4px;" title="ค่าใช้จ่ายต่อตัวสูงขึ้น"></i>`;
        } else if (diff < 0) {
            return `<i class="fa-solid fa-arrow-down" style="color:#15803d; font-size:0.8rem; margin-left:4px;" title="ค่าใช้จ่ายต่อตัวประหยัดขึ้น"></i>`;
        }
        return "";
    }

    function getPctBadge(curVal, cmpVal) {
        if (curVal === null || curVal === undefined || curVal === 0) return `<span style="color:var(--text-muted);">0.0%</span>`;
        if (cmpVal === 0 || !cmpVal) return `<span style="color:var(--text-muted);">-</span>`;

        const diff = curVal - cmpVal;
        const pct = (diff / cmpVal) * 100;

        if (pct > 0) {
            return `<span style="color:#e11d48; font-weight:700;">+${pct.toFixed(1)}%</span>`;
        } else if (pct < 0) {
            return `<span style="color:#15803d; font-weight:700;">${pct.toFixed(1)}%</span>`;
        } else {
            return `<span style="color:var(--text-muted);">0.0%</span>`;
        }
    }

    months.forEach((m, idx) => {
        const isRecorded = !isPartialYear || activeMonthIndices.includes(idx);
        
        const w = curW[idx];
        const wCmp = cmpW[idx] || 0;

        const e = curE[idx];
        const eCmp = cmpE[idx] || 0;

        const g = curG[idx];
        const gCmp = cmpG[idx] || 0;

        const f = curF[idx];
        const fCmp = cmpF[idx] || 0;

        if (isRecorded && w !== null) {
            html += `
            <tr style="text-align:center;">
                <td class="freeze-col" style="text-align:left;"><strong>${m}</strong></td>
                
                <!-- Water Paired Columns -->
                <td style="font-weight:700; color:var(--color-water); background:#f0f9ff;">${w ? w.toFixed(2) : '0.00'} ฿/ตัว ${getArrowIcon(w, wCmp)}</td>
                <td style="color:var(--text-secondary); background:#f0f9ff;">${wCmp ? wCmp.toFixed(2) : '0.00'} ฿/ตัว</td>
                <td style="background:#f0f9ff;">${getPctBadge(w, wCmp)}</td>

                <!-- Elec Paired Columns -->
                <td style="font-weight:700; color:var(--color-elec); background:#fffbeb;">${e ? e.toFixed(2) : '0.00'} ฿/ตัว ${getArrowIcon(e, eCmp)}</td>
                <td style="color:var(--text-secondary); background:#fffbeb;">${eCmp ? eCmp.toFixed(2) : '0.00'} ฿/ตัว</td>
                <td style="background:#fffbeb;">${getPctBadge(e, eCmp)}</td>

                <!-- Gas Paired Columns -->
                <td style="font-weight:700; color:var(--color-gas); background:#ecfdf5;">${g ? g.toFixed(2) : '0.00'} ฿/ตัว ${getArrowIcon(g, gCmp)}</td>
                <td style="color:var(--text-secondary); background:#ecfdf5;">${gCmp ? gCmp.toFixed(2) : '0.00'} ฿/ตัว</td>
                <td style="background:#ecfdf5;">${getPctBadge(g, gCmp)}</td>

                <!-- Fuel Paired Columns -->
                <td style="font-weight:700; color:var(--color-fuel); background:#fff1f2;">${f ? f.toFixed(2) : '0.00'} ฿/ตัว ${getArrowIcon(f, fCmp)}</td>
                <td style="color:var(--text-secondary); background:#fff1f2;">${fCmp ? fCmp.toFixed(2) : '0.00'} ฿/ตัว</td>
                <td style="background:#fff1f2;">${getPctBadge(f, fCmp)}</td>
            </tr>`;
        } else {
            html += `
            <tr class="unrecorded-row" style="opacity:0.65; background:#f8fafc; text-align:center;">
                <td class="freeze-col" style="text-align:left;"><strong>${m}</strong></td>
                <td>0.00 ฿/ตัว</td><td>${wCmp ? wCmp.toFixed(2) : '0.00'} ฿/ตัว</td><td>0.0%</td>
                <td>0.00 ฿/ตัว</td><td>${eCmp ? eCmp.toFixed(2) : '0.00'} ฿/ตัว</td><td>0.0%</td>
                <td>0.00 ฿/ตัว</td><td>${gCmp ? gCmp.toFixed(2) : '0.00'} ฿/ตัว</td><td>0.0%</td>
                <td>0.00 ฿/ตัว</td><td>${fCmp ? fCmp.toFixed(2) : '0.00'} ฿/ตัว</td><td>0.0%</td>
            </tr>`;
        }
    });

    tbody.innerHTML = html;
}

function renderExecutiveInsights(monthlyData, curYear, cmpYear, curTotalCost, cmpTotalCost, curAvgUnit, cmpAvgUnit, elecCost, gasCost, fuelCost, waterCost) {
    const container = document.getElementById("executive-insights-container");
    if (!container) return;

    const recordedMonths = monthlyData.filter(m => m.isRecorded && m.totalCost > 0);
    if (recordedMonths.length === 0) {
        container.innerHTML = `<div style="color:var(--text-muted);">ยังไม่มีข้อมูลวิเคราะห์สำหรับปี ${curYear}</div>`;
        return;
    }

    let maxCostMonth = recordedMonths.reduce((prev, curr) => (curr.totalCost > prev.totalCost) ? curr : prev, recordedMonths[0]);
    const monthsWithProd = recordedMonths.filter(m => m.prod > 0 && m.unitRatio > 0);
    let maxUnitCostMonth = monthsWithProd.length > 0 ? monthsWithProd.reduce((prev, curr) => (curr.unitRatio > prev.unitRatio) ? curr : prev, monthsWithProd[0]) : recordedMonths[0];
    let minUnitCostMonth = monthsWithProd.length > 0 ? monthsWithProd.reduce((prev, curr) => (curr.unitRatio < prev.unitRatio) ? curr : prev, monthsWithProd[0]) : recordedMonths[0];

    const totalResourceCost = (elecCost + gasCost + fuelCost + waterCost) || 1;
    const elecPct = (elecCost / totalResourceCost * 100).toFixed(1);
    const gasPct = (gasCost / totalResourceCost * 100).toFixed(1);
    const fuelPct = (fuelCost / totalResourceCost * 100).toFixed(1);

    const unitDiff = curAvgUnit - cmpAvgUnit;
    const unitPctChange = cmpAvgUnit > 0 ? (unitDiff / cmpAvgUnit * 100) : 0;

    let insightsHtml = "";

    insightsHtml += `
    <div class="insight-item">
        <div class="insight-item-header">
            <i class="fa-solid fa-triangle-exclamation" style="color:#d97706;"></i>
            <span>เดือนที่มีค่าใช้จ่ายพลังงานสูงที่สุด</span>
        </div>
        <div class="insight-tag insight-tag-warning">
            <i class="fa-solid fa-calendar-day"></i> เดือน${maxCostMonth.month} ${curYear}
        </div>
        <div class="insight-text">
            ในเดือน<strong>${maxCostMonth.month}</strong> มียอดค่าพลังงานสูงที่สุด อยู่ที่ <strong>${maxCostMonth.totalCost.toLocaleString('th-TH', {maximumFractionDigits:0})} บาท</strong> 
            (ค่าไฟฟ้า <strong>${maxCostMonth.elecCost.toLocaleString('th-TH', {maximumFractionDigits:0})} บาท</strong>) 
            ส่งผลให้ต้นทุนการผลิตต่อตัวในเดือนนี้อยู่ที่ <strong>${maxCostMonth.unitRatio.toFixed(2)} บาท/ตัว</strong>
        </div>
    </div>`;

    insightsHtml += `
    <div class="insight-item">
        <div class="insight-item-header">
            <i class="fa-solid fa-arrow-trend-up" style="color:#e11d48;"></i>
            <span>เดือนที่ต้นทุนการผลิตต่อตัวแพงที่สุด</span>
        </div>
        <div class="insight-tag insight-tag-danger">
            <i class="fa-solid fa-circle-exclamation"></i> ต้นทุนสูงสุด ${maxUnitCostMonth.unitRatio.toFixed(2)} ฿/ตัว
        </div>
        <div class="insight-text">
            เดือนที่มีต้นทุนการผลิตต่อตัวสูงที่สุดคือ <strong>เดือน${maxUnitCostMonth.month} (${maxUnitCostMonth.unitRatio.toFixed(2)} บาท/ตัว)</strong> 
            เนื่องจากมียอดการผลิตอยู่ที่ ${maxUnitCostMonth.prod.toLocaleString('th-TH')} ตัว ในขณะที่ค่าไฟฟ้าและพลังงานคงที่
        </div>
    </div>`;

    insightsHtml += `
    <div class="insight-item">
        <div class="insight-item-header">
            <i class="fa-solid fa-award" style="color:#059669;"></i>
            <span>เดือนที่มีประสิทธิภาพการผลิตดีที่สุด</span>
        </div>
        <div class="insight-tag insight-tag-success">
            <i class="fa-solid fa-leaf"></i> ประสิทธิภาพสูงสุด ${minUnitCostMonth.unitRatio.toFixed(2)} ฿/ตัว
        </div>
        <div class="insight-text">
            เดือนที่มีต้นทุนพลังงานต่อตัวคุ้มค่าที่สุดคือ <strong>เดือน${minUnitCostMonth.month} (${minUnitCostMonth.unitRatio.toFixed(2)} บาท/ตัว)</strong> 
            โดยมียอดการผลิตสูงถึง <strong>${minUnitCostMonth.prod.toLocaleString('th-TH')} ตัว</strong> ช่วยกระจายต้นทุนคงที่ได้อย่างดีเยี่ยม
        </div>
    </div>`;

    const efficiencyEvalStr = unitDiff < 0 
        ? `<span style="color:#059669; font-weight:700;">มีประสิทธิภาพดีขึ้น ${Math.abs(unitPctChange).toFixed(1)}% (ประหยัดได้ ${Math.abs(unitDiff).toFixed(2)} ฿/ตัว)</span>`
        : `<span style="color:#e11d48; font-weight:700;">ต้นทุนต่อตัวสูงขึ้น +${unitPctChange.toFixed(1)}% (+${unitDiff.toFixed(2)} ฿/ตัว)</span>`;

    insightsHtml += `
    <div class="insight-item">
        <div class="insight-item-header">
            <i class="fa-solid fa-bolt" style="color:#4f46e5;"></i>
            <span>โครงสร้างตัวขับเคลื่อนต้นทุนหลัก (Cost Drivers)</span>
        </div>
        <div class="insight-tag insight-tag-info">
            <i class="fa-solid fa-chart-pie"></i> ค่าไฟฟ้าคิดเป็น ${elecPct}%
        </div>
        <div class="insight-text">
            <strong>ค่าไฟฟ้า</strong> เป็นตัวขับเคลื่อนต้นทุนหลักที่สุด คิดเป็น <strong>${elecPct}%</strong> ของค่าพลังงานทั้งหมด รองลงมาคือ <strong>แก๊ส LPG (${gasPct}%)</strong> และ <strong>น้ำมันเชื้อเพลิง (${fuelPct}%)</strong> 
            ภาพรวมเทียบปี ${cmpYear} ${efficiencyEvalStr}
        </div>
    </div>`;

    container.innerHTML = insightsHtml;
}

function updateYoYBadge(elementId, yoyVal, higherIsBetter, compareLabel) {
    const el = document.getElementById(elementId);
    if (!el) return;

    const formatted = Math.abs(yoyVal).toFixed(1) + "% YoY vs " + compareLabel;
    
    if (yoyVal > 0) {
        if (higherIsBetter) {
            el.className = "badge-yoy-down";
            el.innerHTML = `<i class="fa-solid fa-arrow-up"></i> +${formatted}`;
        } else {
            el.className = "badge-yoy-up";
            el.innerHTML = `<i class="fa-solid fa-arrow-up"></i> +${formatted}`;
        }
    } else if (yoyVal < 0) {
        if (higherIsBetter) {
            el.className = "badge-yoy-up";
            el.innerHTML = `<i class="fa-solid fa-arrow-down"></i> ${formatted}`;
        } else {
            el.className = "badge-yoy-down";
            el.innerHTML = `<i class="fa-solid fa-arrow-down"></i> ${formatted}`;
        }
    } else {
        el.className = "badge-yoy-down";
        el.innerHTML = `0% YoY`;
    }
}

function renderYoYTable(curCosts, cmpCosts, curProds, cmpProds, curRatios, cmpRatios, activeMonthIndices, isPartialYear, cmpYearData) {
    const tbody = document.getElementById("yoy-table-body");
    if (!tbody) return;

    const months = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
    let html = "";
    
    let sumCurCost = 0, sumCmpCost = 0, sumCurProd = 0, sumCmpProd = 0;

    months.forEach((m, idx) => {
        const curC = curCosts[idx];
        const cmpC = cmpCosts[idx] || 0;
        const curP = curProds[idx] || 0;
        const cmpP = cmpProds[idx] || 0;
        const curRatio = curRatios[idx];
        const cmpRatio = cmpRatios[idx] || 0;

        if (curC !== null && curC !== undefined) {
            const diff = curC - cmpC;
            const pct = cmpC > 0 ? (diff / cmpC * 100) : 0;

            const prodDiff = curP - cmpP;
            const prodPct = cmpP > 0 ? (prodDiff / cmpP * 100) : 0;

            const unitRatioDiff = (curRatio || 0) - cmpRatio;
            const unitRatioPct = cmpRatio > 0 ? (unitRatioDiff / cmpRatio * 100) : 0;

            sumCurCost += curC;
            sumCmpCost += cmpC;
            sumCurProd += curP;
            sumCmpProd += cmpP;

            const pctBadge = pct > 0 
                ? `<span style="color:#e11d48; font-weight:700;">+${pct.toFixed(1)}%</span>` 
                : (pct < 0 ? `<span style="color:#15803d; font-weight:700;">${pct.toFixed(1)}%</span>` : `0.0%`);

            const prodPctBadge = prodPct > 0 
                ? `<span style="color:#15803d; font-weight:700;">+${prodPct.toFixed(1)}%</span>` 
                : (prodPct < 0 ? `<span style="color:#e11d48; font-weight:700;">${prodPct.toFixed(1)}%</span>` : `0.0%`);

            const unitPctBadge = unitRatioPct > 0 
                ? `<span style="color:#e11d48; font-weight:700;">+${unitRatioPct.toFixed(1)}%</span>` 
                : (unitRatioPct < 0 ? `<span style="color:#15803d; font-weight:700;">${unitRatioPct.toFixed(1)}%</span>` : `0.0%`);

            html += `
            <tr>
                <td class="freeze-col"><strong>${m}</strong></td>
                <td style="font-weight:700; color:var(--color-primary);">${curC.toLocaleString('th-TH', {minimumFractionDigits: 2})} ฿</td>
                <td>${cmpC.toLocaleString('th-TH', {minimumFractionDigits: 2})} ฿</td>
                <td style="font-weight:600;">${diff > 0 ? '+' : ''}${diff.toLocaleString('th-TH', {minimumFractionDigits: 2})} ฿</td>
                <td>${pctBadge}</td>
                <td>${curP.toLocaleString('th-TH')} ตัว</td>
                <td>${cmpP.toLocaleString('th-TH')} ตัว</td>
                <td style="font-weight:700;">${prodPctBadge}</td>
                <td style="font-weight:700; color:var(--color-accent);">${(curRatio || 0).toFixed(2)} ฿/ตัว</td>
                <td style="color:var(--text-muted);">${cmpRatio.toFixed(2)} ฿/ตัว</td>
                <td style="font-weight:700;">${unitPctBadge}</td>
            </tr>`;
        } else {
            html += `
            <tr class="unrecorded-row" style="opacity: 0.65; background: #f8fafc;">
                <td class="freeze-col"><strong>${m}</strong></td>
                <td style="color:var(--text-muted);">0.00 ฿</td>
                <td>${cmpC.toLocaleString('th-TH', {minimumFractionDigits: 2})} ฿</td>
                <td style="color:var(--text-muted);">0.00 ฿</td>
                <td style="color:var(--text-muted);">0.0%</td>
                <td style="color:var(--text-muted);">0 ตัว</td>
                <td>${cmpP.toLocaleString('th-TH')} ตัว</td>
                <td style="color:var(--text-muted);">0.0%</td>
                <td style="color:var(--text-muted);">0.00 ฿/ตัว</td>
                <td style="color:var(--text-muted);">${cmpRatio.toFixed(2)} ฿/ตัว</td>
                <td style="color:var(--text-muted);">0.0%</td>
            </tr>`;
        }
    });

    tbody.innerHTML = html;

    const tfoot = document.getElementById("yoy-table-foot");
    if (tfoot) {
        const totalDiff = sumCurCost - sumCmpCost;
        const totalPct = sumCmpCost > 0 ? (totalDiff / sumCmpCost * 100) : 0;
        
        const totalProdDiff = sumCurProd - sumCmpProd;
        const totalProdPct = sumCmpProd > 0 ? (totalProdDiff / sumCmpProd * 100) : 0;

        const curAvgUnit = sumCurProd > 0 ? (sumCurCost / sumCurProd) : 0;
        const cmpAvgUnit = sumCmpProd > 0 ? (sumCmpCost / sumCmpProd) : 0;
        
        const totUnitDiff = curAvgUnit - cmpAvgUnit;
        const totUnitPct = cmpAvgUnit > 0 ? (totUnitDiff / cmpAvgUnit * 100) : 0;

        const totalPctBadge = totalPct > 0 
            ? `<span style="color:#e11d48; font-weight:700;">+${totalPct.toFixed(1)}%</span>` 
            : `<span style="color:#15803d; font-weight:700;">${totalPct.toFixed(1)}%</span>`;

        const totalProdPctBadge = totalProdPct > 0 
            ? `<span style="color:#15803d; font-weight:700;">+${totalProdPct.toFixed(1)}%</span>` 
            : `<span style="color:#e11d48; font-weight:700;">${totalProdPct.toFixed(1)}%</span>`;

        const totUnitPctBadge = totUnitPct > 0 
            ? `<span style="color:#e11d48; font-weight:700;">+${totUnitPct.toFixed(1)}%</span>` 
            : `<span style="color:#15803d; font-weight:700;">${totUnitPct.toFixed(1)}%</span>`;

        tfoot.innerHTML = `
        <tr>
            <td class="freeze-col">รวม ${isPartialYear ? `สะสม ${activeMonthIndices.length} เดือน` : 'ตลอดปี'}</td>
            <td style="font-weight:700; font-size:1.05rem; color:var(--color-primary);">${sumCurCost.toLocaleString('th-TH', {minimumFractionDigits: 2})} ฿</td>
            <td style="font-weight:700;">${sumCmpCost.toLocaleString('th-TH', {minimumFractionDigits: 2})} ฿</td>
            <td style="font-weight:700;">${totalDiff > 0 ? '+' : ''}${totalDiff.toLocaleString('th-TH', {minimumFractionDigits: 2})} ฿</td>
            <td>${totalPctBadge}</td>
            <td style="font-weight:700;">${sumCurProd.toLocaleString('th-TH')} ตัว</td>
            <td style="font-weight:700;">${sumCmpProd.toLocaleString('th-TH')} ตัว</td>
            <td style="font-weight:700;">${totalProdPctBadge}</td>
            <td style="font-weight:700; font-size:1.05rem; color:var(--color-accent);">${curAvgUnit.toFixed(2)} ฿/ตัว</td>
            <td style="color:var(--text-muted);">${cmpAvgUnit.toFixed(2)} ฿/ตัว</td>
            <td style="font-weight:700; font-size:1.05rem;">${totUnitPctBadge}</td>
        </tr>`;
    }
}

const DATA_FILES = {
  network: "data/network_state.json",
  shipments: "data/shipments.json",
  demand: "data/demand_forecast.json",
  routes: "data/dispatch_routes.json",
  leakage: "data/revenue_leakage.json",
  depot: "data/depot_flow.json",
  fleet: "data/ev_fleet.json",
  scenarios: "data/scenarios.json",
  activity: "data/activity_feed.json"
};

const state = {
  data: {},
  original: {},
  activePage: "overview",
  activeShipment: null,
  exceptionFilter: "all",
  revenueFilter: "open",
  activeLane: 0,
  routeView: "before",
  simulationRunning: false,
  simulationTimer: null,
  activeScenario: null,
  scenarioResponded: false,
  audit: []
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clone = value => JSON.parse(JSON.stringify(value));
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const money = value => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(value);
const number = value => new Intl.NumberFormat("en-AU").format(Math.round(value));

async function loadData() {
  const entries = await Promise.all(
    Object.entries(DATA_FILES).map(async ([key, url]) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not load ${url}`);
      return [key, await response.json()];
    })
  );
  state.data = Object.fromEntries(entries);
  state.original = clone(state.data);
  state.audit = [
    { agent: "ETA agent", action: "Rerouted TGE-240727 to earlier linehaul", time: "09:54", confidence: 96 },
    { agent: "Revenue agent", action: "Recovered missing fuel surcharge on RA-5998", time: "09:47", confidence: 98 },
    { agent: "Dispatch agent", action: "Balanced 7 routes across SYD metro", time: "09:41", confidence: 94 },
    { agent: "EV agent", action: "Moved 4 vehicles to low-tariff charging", time: "09:32", confidence: 92 }
  ];
}

function init() {
  bindNavigation();
  bindGlobalControls();
  renderAll();
  navigate(location.hash.replace("#", "") || "overview", false);
  setInterval(updateClock, 1000);
  updateClock();
}

function renderAll() {
  renderOverview();
  renderExceptions();
  renderDemand();
  renderDispatch();
  renderRevenue();
  renderDepot();
  renderFleet();
  renderScenarios();
  renderTrust();
  updateBadges();
}

function bindNavigation() {
  $("#primary-nav").addEventListener("click", event => {
    const link = event.target.closest("[data-page]");
    if (!link) return;
    event.preventDefault();
    navigate(link.dataset.page);
  });
  document.addEventListener("click", event => {
    const jump = event.target.closest("[data-jump]");
    if (jump) navigate(jump.dataset.jump);
  });
  window.addEventListener("hashchange", () => navigate(location.hash.replace("#", "") || "overview", false));
  $("#mobile-menu").addEventListener("click", () => $(".sidebar").classList.toggle("open"));
}

function navigate(page, updateHash = true) {
  const target = $(`#page-${page}`);
  if (!target) page = "overview";
  state.activePage = page;
  $$(".page").forEach(el => el.classList.toggle("active", el.id === `page-${page}`));
  $$(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.page === page));
  const active = $(`#page-${page}`);
  $("#page-title").textContent = active.dataset.title;
  $("#page-eyebrow").textContent = active.dataset.eyebrow;
  if (updateHash) history.pushState(null, "", `#${page}`);
  $(".sidebar").classList.remove("open");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindGlobalControls() {
  $("#simulation-toggle").addEventListener("click", toggleSimulation);
  $("#optimize-network").addEventListener("click", runNetworkOptimisation);
  $("#execute-top-decision").addEventListener("click", executeTopDecision);
  $("#clear-feed").addEventListener("click", () => {
    state.data.activity = [];
    renderActivity();
  });
  $$(".loop-node").forEach(node => node.addEventListener("click", () => showLoopModal(node.dataset.loop)));
  $("#modal-close").addEventListener("click", closeModal);
  $("#modal-backdrop").addEventListener("click", e => { if (e.target.id === "modal-backdrop") closeModal(); });
}

function updateClock() {
  $("#live-clock").textContent = new Date().toLocaleTimeString("en-AU", { hour12: false });
}

function toast(title, message, type = "success") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<strong>${title}</strong><p>${message}</p>`;
  $("#notification-stack").prepend(el);
  setTimeout(() => el.remove(), 4200);
}

function openModal(html) {
  $("#modal-content").innerHTML = html;
  $("#modal-backdrop").classList.add("open");
}
function closeModal() { $("#modal-backdrop").classList.remove("open"); }

function showLoopModal(step) {
  const content = {
    sense: ["Sense network state", "Shipment, depot, fleet, customer, finance and external signals are streamed into a common decision context.", ["650+ nodes", "4 modes", "Live events", "Shared context"]],
    predict: ["Predict risk + demand", "Models continuously score late risk, demand, empty kilometres, margin leakage, depot congestion and carbon impact.", ["ETA risk", "Demand", "Margin", "Carbon"]],
    decide: ["Recommend best action", "Agents evaluate service, cost, cash and carbon together, then produce an explainable recommendation for human approval.", ["Reroute", "Reprice", "Notify", "Escalate"]],
    learn: ["Learn from outcomes", "Observed results feed back into route, pricing, service and capacity logic, improving future recommendations.", ["Outcome log", "Accuracy", "Drift checks", "Policy tuning"]]
  }[step];
  openModal(`<span class="eyebrow">AIONOS DECISION LOOP</span><h2>${content[0]}</h2><p>${content[1]}</p><div class="modal-result">${content[2].map(x => `<div><small>CAPABILITY</small><strong>${x}</strong></div>`).join("")}</div><button class="btn btn-primary btn-block" onclick="document.getElementById('modal-close').click()">Return to mission control</button>`);
}

function metricValue(metric) {
  if (metric.unit === "AUD") return money(metric.current);
  if (metric.unit === "%") return `${metric.current.toFixed(1)}%`;
  if (metric.unit === "count") return number(metric.current);
  return Math.round(metric.current).toString();
}

function improvement(metric) {
  if (metric.baseline === 0) return metric.current > 0 ? `+${number(metric.current)}` : "—";
  const raw = ((metric.current - metric.baseline) / metric.baseline) * 100;
  const adjusted = metric.direction === "down" ? -raw : raw;
  return `${adjusted >= 0 ? "+" : ""}${adjusted.toFixed(1)}% vs baseline`;
}

function sparkPoints(baseline, current, width = 120, height = 28) {
  const values = Array.from({ length: 12 }, (_, i) => {
    const t = i / 11;
    return baseline + (current - baseline) * t + Math.sin(i * 1.7) * Math.abs(current - baseline || baseline * .05) * .08;
  });
  const min = Math.min(...values), max = Math.max(...values);
  return values.map((v, i) => {
    const x = i * width / (values.length - 1);
    const y = height - 2 - ((v - min) / ((max - min) || 1)) * (height - 5);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function renderOverview() {
  renderExecutiveKpis();
  renderTopDecision();
  renderNetworkMap();
  renderActivity();
  renderTrajectory();
  renderOutcomes();
}

function renderExecutiveKpis() {
  const keys = ["onTimePerformance", "costToServe", "revenueRecovered", "carbonPerShipment"];
  $("#executive-kpis").innerHTML = keys.map(key => {
    const m = state.data.network.kpis[key];
    const good = m.direction === "down" ? m.current <= m.baseline : m.current >= m.baseline;
    return `<article class="kpi-card">
      <div class="kpi-top"><small>${m.label}</small><span class="kpi-change ${good ? "good" : "bad"}">${improvement(m)}</span></div>
      <strong>${metricValue(m)}</strong>
      <small>${m.unit === "index" ? "Baseline = 100" : key === "revenueRecovered" ? "Validated opportunity" : "Current network view"}</small>
      <div class="sparkline"><svg viewBox="0 0 120 28" preserveAspectRatio="none"><polyline points="${sparkPoints(m.baseline, m.current)}" fill="none" stroke="#7ac143" stroke-width="2"/><polyline points="0,27 ${sparkPoints(m.baseline, m.current)} 120,27" fill="rgba(122,193,67,.08)" stroke="none"/></svg></div>
    </article>`;
  }).join("");
}

function highestRiskShipment() {
  return [...state.data.shipments].filter(s => !s.acted).sort((a, b) => b.risk - a.risk)[0] || state.data.shipments[0];
}

function renderTopDecision() {
  const s = highestRiskShipment();
  $("#top-decision-title").textContent = `${s.id} · ${s.origin} → ${s.destination}`;
  $("#top-decision-copy").textContent = `${s.recommendedAction}. Predicted delay is ${s.predictedDelayMinutes} minutes with ${s.etaConfidence}% ETA confidence.`;
  $("#top-decision-impact").innerHTML = `
    <div><small>Late risk</small><strong>${s.risk}% → ${Math.max(9, s.risk - 47)}%</strong></div>
    <div><small>Customer SLA</small><strong>${s.status === "Out for delivery" ? "Protect" : "Recover"}</strong></div>
    <div><small>Margin at risk</small><strong>${money(s.revenue * Math.max(0.05, (16-s.marginPct)/100))}</strong></div>
    <div><small>Decision confidence</small><strong>${clamp(s.etaConfidence + 24, 80, 99)}%</strong></div>`;
}

function executeTopDecision() {
  const s = highestRiskShipment();
  if (!s || s.acted) return toast("No action required", "The highest-priority decision has already been handled.");
  const previous = s.risk;
  s.risk = Math.max(8, s.risk - 48);
  s.etaConfidence = clamp(s.etaConfidence + 22, 0, 99);
  s.predictedDelayMinutes = Math.max(0, s.predictedDelayMinutes - 88);
  s.acted = true;
  state.data.network.kpis.lateExceptionRate.current = Math.max(6.8, state.data.network.kpis.lateExceptionRate.current - .7);
  state.data.network.kpis.onTimePerformance.current = Math.min(98.2, state.data.network.kpis.onTimePerformance.current + .35);
  addActivity("ETA", `${s.id} action approved; risk reduced ${previous}% → ${s.risk}%.`, "low");
  addAudit("ETA agent", `${s.recommendedAction} for ${s.id}`, clamp(s.etaConfidence + 8, 0, 99));
  renderOverview();
  renderExceptions();
  renderTrust();
  updateBadges();
  toast("Intervention executed", `${s.id} has been rerouted and the receiver notification has been queued.`);
}

function renderNetworkMap() {
  const depots = state.data.network.network.depots;
  const links = [["PER","ADL"],["ADL","MEL"],["MEL","SYD"],["SYD","BNE"],["BNE","DRW"],["SYD","AKL"],["MEL","HBA"],["PER","DRW"],["BNE","AKL"]];
  const depotMap = Object.fromEntries(depots.map(d => [d.id, d]));
  $("#network-links").innerHTML = links.map(([a,b]) => {
    const d1 = depotMap[a], d2 = depotMap[b];
    const hot = d1.status === "critical" || d2.status === "critical";
    return `<line class="network-link ${hot ? "hot" : ""}" x1="${d1.x}" y1="${d1.y}" x2="${d2.x}" y2="${d2.y}"/>`;
  }).join("");
  $("#network-nodes").innerHTML = depots.map(d => {
    const color = d.status === "critical" ? "#e85b5b" : d.status === "watch" ? "#f5b94c" : "#7ac143";
    return `<g class="map-node" data-depot="${d.id}" transform="translate(${d.x} ${d.y})">
      <circle class="node-ring" r="3.2" stroke="${color}"/><circle class="node-dot" r="1.6" fill="${color}"/><text class="node-label" x="2.7" y="1">${d.id}</text>
    </g>`;
  }).join("");
  $$(".map-node").forEach(node => {
    node.addEventListener("mouseenter", e => {
      const d = depotMap[node.dataset.depot], tip = $("#map-tooltip"), box = $(".network-map").getBoundingClientRect();
      tip.innerHTML = `<strong>${d.name}</strong>Load ${d.load}% · ${number(d.throughput)} items/hr<br>Dwell ${d.dwell} min · ${d.status.toUpperCase()}`;
      tip.style.left = `${e.clientX - box.left + 8}px`;
      tip.style.top = `${e.clientY - box.top + 8}px`;
      tip.style.display = "block";
    });
    node.addEventListener("mouseleave", () => $("#map-tooltip").style.display = "none");
  });
  $("#mode-strip").innerHTML = state.data.network.network.modeMix.map(m => `<div class="mode-item"><span>${m.mode}</span><strong>${m.share}%</strong><div class="mode-bar"><i style="width:${m.share}%"></i></div></div>`).join("");
}

function renderActivity() {
  $("#activity-feed").innerHTML = state.data.activity.length ? state.data.activity.map(item => `<div class="feed-item">
    <span class="feed-badge ${item.severity}">${item.type.slice(0,2).toUpperCase()}</span>
    <div><p>${item.message}</p><small>${item.time} · ${item.type} agent</small></div>
  </div>`).join("") : `<div class="empty-state" style="min-height:280px"><span>✓</span><h3>Feed cleared</h3><p>New network decisions will appear here.</p></div>`;
}

function addActivity(type, message, severity = "low") {
  state.data.activity.unshift({ time: new Date().toLocaleTimeString("en-AU", { hour12: false }), type, message, severity });
  state.data.activity = state.data.activity.slice(0, 24);
  renderActivity();
}

function addAudit(agent, action, confidence) {
  state.audit.unshift({ agent, action, confidence, time: new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false }) });
  state.audit = state.audit.slice(0, 10);
}

function renderTrajectory() {
  const points = {
    "Service":[89,89.5,90.4,91.3,92.8,93.7,94.8],
    "Cost":[100,98,96,93,90,88,86],
    "Productivity":[100,101,102,104,105,107,108],
    "Carbon":[100,99.5,98,97.2,96.3,95.1,94]
  };
  const colors = ["#7ac143","#4aa3ff","#f5b94c","#8d6fe8"];
  const w=650,h=190,pad=28;
  const all=Object.values(points).flat(), min=Math.min(...all)-2,max=Math.max(...all)+2;
  const path = vals => vals.map((v,i)=>`${pad+i*(w-pad*2)/(vals.length-1)},${h-pad-(v-min)/(max-min)*(h-pad*2)}`).join(" ");
  $("#trajectory-chart").innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="100%">
    ${[0,1,2,3].map(i=>`<line class="chart-grid" x1="${pad}" x2="${w-pad}" y1="${pad+i*(h-pad*2)/3}" y2="${pad+i*(h-pad*2)/3}"/>`).join("")}
    ${Object.entries(points).map(([label,vals],i)=>`<polyline points="${path(vals)}" fill="none" stroke="${colors[i]}" stroke-width="3" stroke-linecap="round"/><text x="${w-pad-3}" y="${path(vals).split(" ").at(-1).split(",")[1]-5}" text-anchor="end" font-size="8" fill="${colors[i]}">${label}</text>`).join("")}
    ${["Baseline","Day 15","Day 30","Day 45","Day 60","Day 75","Day 90"].map((d,i)=>`<text class="chart-label" x="${pad+i*(w-pad*2)/6}" y="${h-4}" text-anchor="middle">${d}</text>`).join("")}
  </svg>`;
}

function renderOutcomes() {
  const k = state.data.network.kpis;
  const data = [
    ["SERVICE",`${k.onTimePerformance.current.toFixed(1)}%`,"On-time performance"],
    ["COST",`${Math.round(k.costToServe.current)}`,"Cost-to-serve index"],
    ["CASH",money(k.revenueRecovered.current),"Validated recovery"],
    ["CARBON",`${Math.round(k.carbonPerShipment.current)}`,"Emissions index"]
  ];
  $("#outcome-quadrants").innerHTML = data.map(([label,val,desc]) => `<div class="outcome-cell"><small>${label}</small><strong>${val}</strong><span>${desc}</span></div>`).join("");
}

function renderExceptions() {
  bindExceptionControls();
  renderShipmentList();
  if (state.activeShipment) renderShipmentDetail(state.activeShipment);
}

function bindExceptionControls() {
  if ($("#exception-filters").dataset.bound) return;
  $("#exception-filters").dataset.bound = "1";
  $("#exception-filters").addEventListener("click", e => {
    const btn = e.target.closest("[data-risk]"); if (!btn) return;
    state.exceptionFilter = btn.dataset.risk;
    $$("#exception-filters .filter").forEach(x => x.classList.toggle("active", x === btn));
    renderShipmentList();
  });
  $("#shipment-search").addEventListener("input", renderShipmentList);
}

function filteredShipments() {
  const q = $("#shipment-search")?.value.toLowerCase() || "";
  return [...state.data.shipments]
    .filter(s => state.exceptionFilter === "all" || (state.exceptionFilter === "critical" ? s.risk >= 60 : s.risk >= 30 && s.risk < 60))
    .filter(s => [s.id,s.customer,s.origin,s.destination].join(" ").toLowerCase().includes(q))
    .sort((a,b)=>b.risk-a.risk);
}

function riskColor(risk) { return risk >= 60 ? "#e85b5b" : risk >= 30 ? "#f5b94c" : "#7ac143"; }

function renderShipmentList() {
  const list = filteredShipments();
  $("#shipment-count").textContent = `${list.length} shipments`;
  $("#shipment-list").innerHTML = list.map(s => `<div class="shipment-row ${state.activeShipment === s.id ? "active" : ""}" data-shipment="${s.id}">
    <div class="risk-dial" style="--risk:${s.risk};--risk-color:${riskColor(s.risk)}"><span>${s.risk}</span></div>
    <div class="shipment-main"><strong>${s.id} · ${s.customer}</strong><span>${s.origin} → ${s.destination} · ${s.mode} · ${s.status}</span><small>${s.recommendedAction}</small></div>
    <div class="shipment-meta"><b>${s.predictedDelayMinutes ? `+${s.predictedDelayMinutes} min` : "On plan"}</b><small>${s.marginPct}% margin</small></div>
  </div>`).join("");
  $$(".shipment-row").forEach(row => row.addEventListener("click", () => {
    state.activeShipment = row.dataset.shipment;
    renderShipmentList();
    renderShipmentDetail(state.activeShipment);
  }));
}

function renderShipmentDetail(id) {
  const s = state.data.shipments.find(x => x.id === id);
  if (!s) return;
  const steps = ["Booked","Picked up","Linehaul","Depot scan","Out for delivery"];
  const current = steps.indexOf(s.status);
  $("#shipment-detail").innerHTML = `
    <div class="detail-title"><div><span class="eyebrow">SHIPMENT DECISION</span><h2>${s.id}</h2><p>${s.customer} · ${s.commodity} · ${number(s.weightKg)} kg</p></div><span class="priority-tag ${s.risk>=60?"high":""}" style="${s.risk<60?"background:#fff2d6;color:#936000":""}">${s.risk>=60?"CRITICAL":"WATCH"} · ${s.risk}%</span></div>
    <div class="risk-banner"><div class="risk-big">${s.risk}%</div><div><h3>${s.predictedDelayMinutes ? `${s.predictedDelayMinutes}-minute delay predicted` : "Shipment is recovering"}</h3><p>ETA confidence ${s.etaConfidence}%. Risk combines handoff dwell, lane congestion, route fit, service promise and current network conditions.</p></div></div>
    <div class="journey">${steps.map((step,i)=>`<div class="journey-step ${i<current?"done":i===current?"current":""}"><i></i><span>${step}</span><b>${i<current?"Complete":i===current?`${s.risk}% risk`:"Pending"}</b></div>`).join("")}</div>
    <div class="detail-metrics">
      <div class="mini-metric"><small>PROMISED</small><strong>${s.promised}</strong></div>
      <div class="mini-metric"><small>REVENUE</small><strong>${money(s.revenue)}</strong></div>
      <div class="mini-metric"><small>SHIPMENT MARGIN</small><strong>${s.marginPct}%</strong></div>
      <div class="mini-metric"><small>ETA CONFIDENCE</small><strong>${s.etaConfidence}%</strong></div>
    </div>
    <div class="recommendation-box"><span class="eyebrow">AIONOS RECOMMENDATION</span><h3>${s.recommendedAction}</h3><p>Expected result: reduce late risk to ${Math.max(7,s.risk-45)}%, protect the customer promise and avoid approximately ${money(Math.max(80,s.revenue*.07))} in recovery cost.</p></div>
    <div class="action-row"><button class="btn btn-primary" id="approve-shipment-action" ${s.acted?"disabled":""}>${s.acted?"Action completed":"Approve action"}</button><button class="btn btn-secondary" id="shipment-evidence">View evidence</button></div>
    <div class="evidence-list">
      <div class="evidence-item"><span>Destination depot dwell trend</span><b>${s.risk>=60?"+31%":"Stable"}</b></div>
      <div class="evidence-item"><span>Lane capacity utilisation</span><b>${s.risk>=60?"91%":"76%"}</b></div>
      <div class="evidence-item"><span>Alternative connection availability</span><b>Confirmed</b></div>
      <div class="evidence-item"><span>Customer notification preference</span><b>Proactive SMS + email</b></div>
    </div>`;
  $("#approve-shipment-action").addEventListener("click", () => approveShipment(s.id));
  $("#shipment-evidence").addEventListener("click", () => openModal(`<span class="eyebrow">DECISION EVIDENCE</span><h2>${s.id} · Why this action?</h2><p>The recommendation combines five grounded signals: recent depot dwell, lane capacity, vehicle arrival probability, service-priority rules and customer communication preference.</p><div class="modal-result"><div><small>MODEL CONFIDENCE</small><strong>${clamp(s.etaConfidence+18,0,99)}%</strong></div><div><small>ALTERNATIVES TESTED</small><strong>7</strong></div><div><small>POLICIES PASSED</small><strong>12/12</strong></div><div><small>HUMAN APPROVAL</small><strong>${s.acted?"Complete":"Required"}</strong></div></div>`));
}

function approveShipment(id) {
  const s = state.data.shipments.find(x => x.id === id);
  if (!s || s.acted) return;
  const old = s.risk;
  s.risk = Math.max(6, s.risk - 44);
  s.predictedDelayMinutes = Math.max(0, s.predictedDelayMinutes - 105);
  s.etaConfidence = Math.min(99, s.etaConfidence + 23);
  s.acted = true;
  state.data.network.kpis.onTimePerformance.current += .22;
  state.data.network.kpis.lateExceptionRate.current = Math.max(6.8,state.data.network.kpis.lateExceptionRate.current-.35);
  addActivity("ETA", `${s.id} intervention approved; late risk reduced ${old}% → ${s.risk}%.`, "low");
  addAudit("ETA agent", `${s.recommendedAction} for ${s.id}`, s.etaConfidence);
  renderExceptions(); renderOverview(); renderTrust(); updateBadges();
  toast("Shipment recovered", `${s.id} is now on the optimised execution path.`);
}

function renderDemand() {
  if (!$("#lane-list").dataset.bound) {
    $("#lane-list").dataset.bound = "1";
    $("#commit-capacity").addEventListener("click", commitCapacity);
  }
  $("#lane-list").innerHTML = state.data.demand.map((l,i)=>`<div class="lane-item ${i===state.activeLane?"active":""}" data-lane="${i}">
    <div class="lane-line"><strong>${l.lane}</strong><span>${l.capacityUtilisation}% utilised</span></div>
    <div class="lane-meter"><i style="width:${l.capacityUtilisation}%"></i></div>
    <small>${l.recommendedCapacity}</small>
  </div>`).join("");
  $$(".lane-item").forEach(el=>el.addEventListener("click",()=>{state.activeLane=Number(el.dataset.lane);renderDemand()}));
  renderDemandChart();
  $("#capacity-actions").innerHTML = [
    ["⌂","Labour scheduled earlier","Flex shifts align to predicted arrival waves.","+8% productivity"],
    ["▰","Linehaul reserved","Capacity is held before premium recovery is required.","-12% recovery cost"],
    ["⇄","Mode swaps proposed","Rail, road and air options are compared by SLA and margin.","-6% carbon"],
    ["◌","Customers nudged","Flexible customers receive better slots before peak.","+4 pts capacity"]
  ].map(x=>`<article class="action-card"><span>${x[0]}</span><h3>${x[1]}</h3><p>${x[2]}</p><b>${x[3]}</b></article>`).join("");
}

function renderDemandChart() {
  const lane=state.data.demand[state.activeLane], actual=lane.history, fc=lane.forecast;
  const vals=[...actual,...fc], w=760,h=330,p={l:45,r:22,t:28,b:32},min=Math.min(...vals)*.91,max=Math.max(...vals)*1.06;
  const x=i=>p.l+i*(w-p.l-p.r)/(vals.length-1), y=v=>h-p.b-(v-min)/(max-min)*(h-p.t-p.b);
  const actualPts=actual.map((v,i)=>`${x(i)},${y(v)}`).join(" ");
  const fcPts=[actual.at(-1),...fc].map((v,i)=>`${x(i+actual.length-1)},${y(v)}`).join(" ");
  const peakIndex=lane.peakDay+actual.length;
  $("#demand-lane-title").textContent=lane.lane;
  $("#forecast-confidence").textContent=`${lane.forecastAccuracy}% forecast accuracy`;
  $("#demand-chart").innerHTML=`<svg viewBox="0 0 ${w} ${h}" width="100%" height="100%">
    <defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7ac143" stop-opacity=".24"/><stop offset="1" stop-color="#7ac143" stop-opacity="0"/></linearGradient></defs>
    ${[0,1,2,3,4].map(i=>{const yy=p.t+i*(h-p.t-p.b)/4;const val=max-i*(max-min)/4;return `<line class="chart-grid" x1="${p.l}" x2="${w-p.r}" y1="${yy}" y2="${yy}"/><text class="chart-label" x="${p.l-7}" y="${yy+3}" text-anchor="end">${number(val)}</text>`}).join("")}
    <line x1="${x(actual.length-1)}" x2="${x(actual.length-1)}" y1="${p.t}" y2="${h-p.b}" stroke="#b5c0c6" stroke-dasharray="4 4"/>
    <polygon points="${fcPts} ${x(vals.length-1)},${h-p.b} ${x(actual.length-1)},${h-p.b}" fill="url(#chartFill)"/>
    <polyline class="chart-actual" points="${actualPts}"/><polyline class="chart-line" points="${fcPts}"/>
    ${fc.map((v,i)=>`<circle class="${i===lane.peakDay?"chart-peak":"chart-dot"}" cx="${x(actual.length+i)}" cy="${y(v)}" r="${i===lane.peakDay?5:3.5}"/>`).join("")}
    <text x="${x(actual.length-1)-8}" y="${p.t+9}" text-anchor="end" class="chart-label">HISTORY</text><text x="${x(actual.length-1)+8}" y="${p.t+9}" class="chart-label">AI FORECAST</text>
    <text x="${x(peakIndex)}" y="${y(fc[lane.peakDay])-12}" text-anchor="middle" font-size="8" font-weight="bold" fill="#a36a00">PEAK PREDICTED</text>
    ${["-14d","-10d","-6d","Today","+3d","+7d"].map((label,i)=>`<text class="chart-label" x="${p.l+i*(w-p.l-p.r)/5}" y="${h-8}" text-anchor="middle">${label}</text>`).join("")}
  </svg>`;
  const peak=Math.max(...fc), avg=fc.reduce((a,b)=>a+b,0)/fc.length;
  $("#forecast-summary").innerHTML=`<div><small>7-DAY AVERAGE</small><strong>${number(avg)} items/day</strong></div><div><small>PEAK VOLUME</small><strong>${number(peak)} items</strong></div><div><small>RECOMMENDED ACTION</small><strong>${lane.recommendedCapacity}</strong></div>`;
}

function commitCapacity() {
  const lane=state.data.demand[state.activeLane];
  lane.capacityUtilisation=Math.max(62,lane.capacityUtilisation-9);
  state.data.network.kpis.depotProductivity.current=Math.min(114,state.data.network.kpis.depotProductivity.current+1.2);
  addActivity("Demand", `${lane.lane}: ${lane.recommendedCapacity} committed; capacity risk reduced.`, "low");
  addAudit("Demand agent", `Committed capacity plan for ${lane.lane}`, Math.round(lane.forecastAccuracy));
  renderDemand();renderOverview();renderTrust();
  toast("Capacity committed", `${lane.lane} now has protected capacity for the predicted peak.`);
}

function renderDispatch() {
  if (!$("#optimize-routes").dataset.bound) {
    $("#optimize-routes").dataset.bound="1";
    $("#optimize-routes").addEventListener("click", optimizeRoutes);
    $(".view-toggle").addEventListener("click",e=>{const b=e.target.closest("[data-route-view]");if(!b)return;state.routeView=b.dataset.routeView;$$(".view-toggle button").forEach(x=>x.classList.toggle("active",x===b));renderRouteVisual()});
  }
  const routes=state.data.routes;
  const sums=routes.reduce((a,r)=>{a.stopsB+=r.stopsBefore;a.stopsA+=r.stopsAfter;a.kmB+=r.kmBefore;a.kmA+=r.kmAfter;a.emptyB+=r.emptyKmBefore;a.emptyA+=r.emptyKmAfter;a.missedB+=r.missedBefore;a.missedA+=r.missedAfter;return a},{stopsB:0,stopsA:0,kmB:0,kmA:0,emptyB:0,emptyA:0,missedB:0,missedA:0});
  $("#dispatch-summary").innerHTML=[
    ["Stops / shift",sums.stopsB,sums.stopsA,"More productive"],
    ["Route kilometres",sums.kmB,sums.kmA,"Less distance"],
    ["Empty kilometres",sums.emptyB,sums.emptyA,"Less waste"],
    ["Missed deliveries",sums.missedB,sums.missedA,"Better service"]
  ].map(([l,b,a,n])=>`<div class="summary-card"><span>${l}</span><strong>${number(b)} → ${number(a)}</strong><small>${Math.abs((a-b)/b*100).toFixed(1)}% ${n}</small></div>`).join("");
  renderRouteVisual();
  $("#route-card-grid").innerHTML=routes.map(r=>`<article class="route-card"><div class="route-card-head"><div><h3>${r.routeId}</h3><small>${r.driver}</small></div><span class="status-chip">${r.status==="released"?"Released":"Ready"}</span></div><div class="route-deltas"><div><span>STOPS</span><b>${r.stopsBefore} → ${r.stopsAfter}</b></div><div><span>EMPTY KM</span><b>${r.emptyKmBefore} → ${r.emptyKmAfter}</b></div><div><span>TOTAL KM</span><b>${r.kmBefore} → ${r.kmAfter}</b></div><div><span>MISSED</span><b>${r.missedBefore} → ${r.missedAfter}</b></div></div><button class="btn ${r.status==="released"?"btn-secondary":"btn-primary"}" data-release="${r.routeId}" ${r.status==="released"?"disabled":""}>${r.status==="released"?"Released to driver":"Release route"}</button></article>`).join("");
  $$("[data-release]").forEach(b=>b.addEventListener("click",()=>releaseRoute(b.dataset.release)));
}

function renderRouteVisual() {
  const optimized=state.routeView==="after", routes=state.data.routes,w=900,h=280;
  const colors=["#7ac143","#4aa3ff","#f5b94c","#8d6fe8","#e85b5b"];
  let svg=`<svg viewBox="0 0 ${w} ${h}" width="100%" height="100%"><defs><pattern id="grid" width="35" height="35" patternUnits="userSpaceOnUse"><path d="M35 0H0V35" fill="none" stroke="#19303b" stroke-width=".7"/></pattern></defs><rect width="${w}" height="${h}" fill="url(#grid)"/>`;
  routes.forEach((r,idx)=>{
    const count=optimized?r.stopsAfter:r.stopsBefore;
    const points=Array.from({length:Math.min(18,Math.round(count/5.5))},(_,i)=>{
      const baseX=80+idx*160, angle=i*.95+idx, radius=(optimized?34:57)+(i%4)*8;
      return [clamp(baseX+Math.cos(angle)*radius,20,w-20),clamp(140+Math.sin(angle*1.2)*radius,20,h-20)];
    });
    const path=points.map((p,i)=>`${i?"L":"M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
    svg+=`<path class="route-path" d="${path}" stroke="${colors[idx]}" opacity="${optimized?.9:.58}"/>${points.map(p=>`<circle class="route-stop" cx="${p[0]}" cy="${p[1]}" r="${optimized?3.2:2.7}" fill="${colors[idx]}"/>`).join("")}<text class="route-label" x="${80+idx*160}" y="265" text-anchor="middle">${r.routeId} · ${optimized?"AI BALANCED":"STATIC"}</text>`;
  });
  svg+=`<text x="18" y="22" fill="#7ac143" font-size="9" font-weight="bold">${optimized?"AI-OPTIMISED ROUTE DENSITY":"STATIC ROUTE PLAN"}</text></svg>`;
  $("#route-visual").innerHTML=svg;
}

function optimizeRoutes() {
  state.routeView="after";
  $$(".view-toggle button").forEach(x=>x.classList.toggle("active",x.dataset.routeView==="after"));
  state.data.network.kpis.emptyKilometres.current=Math.max(88,state.data.network.kpis.emptyKilometres.current-4);
  state.data.network.kpis.costToServe.current=Math.max(82,state.data.network.kpis.costToServe.current-2);
  addActivity("Dispatch","Five metro routes rebalanced; 86 empty kilometres removed.","low");
  addAudit("Dispatch agent","Optimised all active metro routes",96);
  renderDispatch();renderOverview();renderTrust();
  toast("Routes optimised","Stops were rebalanced around density, SLA and first-attempt probability.");
}

function releaseRoute(id) {
  const r=state.data.routes.find(x=>x.routeId===id); if(!r)return;
  r.status="released";addActivity("Dispatch",`${id} AI-balanced plan released to ${r.driver}.`,"low");addAudit("Dispatch agent",`Released ${id} to driver`,94);renderDispatch();renderTrust();toast("Route released",`${id} is now available in the driver workflow.`);
}

function renderRevenue() {
  if (!$("#revenue-filters").dataset.bound) {
    $("#revenue-filters").dataset.bound="1";
    $("#revenue-filters").addEventListener("click",e=>{const b=e.target.closest("[data-revenue]");if(!b)return;state.revenueFilter=b.dataset.revenue;$$('#revenue-filters .filter').forEach(x=>x.classList.toggle("active",x===b));renderRevenueTable()});
    $("#recover-all").addEventListener("click",recoverAll);
  }
  const open=state.data.leakage.filter(x=>x.status==="open"), recovered=state.data.leakage.filter(x=>x.status==="recovered");
  const openAmount=open.reduce((a,b)=>a+b.amount,0), recoveredAmount=recovered.reduce((a,b)=>a+b.amount,0);
  $("#revenue-kpis").innerHTML=[
    ["Open recovery",money(openAmount),`${open.length} cases`],
    ["Recovered today",money(recoveredAmount),`${recovered.length} approved`],
    ["Average confidence",`${(state.data.leakage.reduce((a,b)=>a+b.confidence,0)/state.data.leakage.length).toFixed(1)}%`,"Evidence grounded"],
    ["Annualised opportunity",money((openAmount+recoveredAmount)*18.6),"Illustrative run-rate"]
  ].map(x=>`<div class="summary-card"><span>${x[0]}</span><strong>${x[1]}</strong><small>${x[2]}</small></div>`).join("");
  renderRevenueTable();
}

function renderRevenueTable() {
  const rows=state.data.leakage.filter(x=>state.revenueFilter==="all"||x.status===state.revenueFilter);
  $("#revenue-table").innerHTML=rows.map(c=>`<tr><td><strong>${c.caseId}</strong><small>${c.severity} severity</small></td><td><strong>${c.shipmentId}</strong><small>${c.customer}</small></td><td><strong>${c.type}</strong><small>${c.evidence}</small></td><td><strong>${c.confidence}%</strong><div class="confidence-bar"><i style="width:${c.confidence}%"></i></div></td><td class="money">${money(c.amount)}</td><td><button class="table-action" data-recover="${c.caseId}" ${c.status==="recovered"?"disabled":""}>${c.status==="recovered"?"Recovered":"Approve recovery"}</button></td></tr>`).join("");
  $$("[data-recover]").forEach(b=>b.addEventListener("click",()=>recoverCase(b.dataset.recover)));
}

function recoverCase(id) {
  const c=state.data.leakage.find(x=>x.caseId===id);if(!c||c.status==="recovered")return;
  c.status="recovered";state.data.network.kpis.revenueRecovered.current+=c.amount;
  addActivity("Revenue",`${c.caseId}: ${money(c.amount)} ${c.type.toLowerCase()} approved for recovery.`,"low");
  addAudit("Revenue agent",`Approved ${c.caseId} recovery`,c.confidence);
  renderRevenue();renderOverview();renderTrust();updateBadges();toast("Revenue recovered",`${money(c.amount)} has been routed to billing correction.`);
}

function recoverAll() {
  const cases=state.data.leakage.filter(x=>x.status==="open"&&x.confidence>=94);
  const total=cases.reduce((a,b)=>a+b.amount,0);cases.forEach(c=>c.status="recovered");
  state.data.network.kpis.revenueRecovered.current+=total;
  addActivity("Revenue",`${cases.length} high-confidence cases approved; ${money(total)} routed to billing.`,"low");
  addAudit("Revenue agent",`Batch-approved ${cases.length} high-confidence cases`,97);
  renderRevenue();renderOverview();renderTrust();updateBadges();toast("Batch recovery approved",`${cases.length} cases worth ${money(total)} moved to billing correction.`);
}

function renderDepot() {
  if (!$("#rebalance-depot").dataset.bound) {$("#rebalance-depot").dataset.bound="1";$("#rebalance-depot").addEventListener("click",rebalanceDepot);}
  const zones=state.data.depot.zones;
  $("#depot-diagram").innerHTML=zones.map(z=>`<div class="depot-zone ${z.load>=90?"critical":z.load>=80?"hot":""}" style="--load:${z.load}%"><h4>${z.zone}</h4><span>${z.queue} queued · ${z.labour} people</span><strong>${z.load}%</strong></div>`).join("");
  const a=state.data.depot.arrivalWaves,t=state.data.depot.throughput,w=420,h=230,p=28,max=105;
  const pts=vals=>vals.map((v,i)=>`${p+i*(w-p*2)/(vals.length-1)},${h-p-v/max*(h-p*2)}`).join(" ");
  $("#depot-flow-chart").innerHTML=`<svg viewBox="0 0 ${w} ${h}" width="100%" height="100%">${[0,1,2,3,4].map(i=>`<line class="chart-grid" x1="${p}" x2="${w-p}" y1="${p+i*(h-p*2)/4}" y2="${p+i*(h-p*2)/4}"/>`).join("")}<polyline points="${pts(a)}" fill="none" stroke="#f5b94c" stroke-width="3"/><polyline points="${pts(t)}" fill="none" stroke="#7ac143" stroke-width="3"/><text x="34" y="18" font-size="8" fill="#a36a00">ARRIVAL WAVE</text><text x="126" y="18" font-size="8" fill="#4c8b28">THROUGHPUT</text>${["Now","+1h","+2h","+3h","+4h","+5h"].map((x,i)=>`<text class="chart-label" x="${p+i*(w-p*2)/5}" y="${h-5}" text-anchor="middle">${x}</text>`).join("")}</svg>`;
  const hottest=[...zones].sort((a,b)=>b.load-a.load)[0];
  $("#depot-decision").innerHTML=`<span class="eyebrow">PREDICTED BOTTLENECK</span><h3>${hottest.zone} reaches ${hottest.load}% load</h3><p>${hottest.recommendation}. This protects the next departure wave and reduces projected dwell by 17 minutes.</p>`;
  $("#zone-grid").innerHTML=zones.map(z=>`<article class="zone-card"><h3>${z.zone}</h3><div class="zone-load"><strong>${z.load}%</strong><span>${z.queue} queued<br>${z.dwell} min dwell</span></div><p>${z.recommendation}</p><b>${z.load>=80?"Action recommended":"Flow within threshold"}</b></article>`).join("");
  const risk=Math.max(...zones.map(z=>z.load));$("#depot-risk-tag").textContent=risk>=90?"Congestion forming":"Flow stabilised";$("#depot-risk-tag").className=`priority-tag ${risk>=90?"high":""}`;
}

function rebalanceDepot() {
  state.data.depot.zones.forEach(z=>{z.load=Math.max(48,z.load-rand(7,16));z.queue=Math.max(2,z.queue-rand(3,9));z.dwell=Math.max(18,z.dwell-rand(8,19))});
  state.data.depot.throughput=state.data.depot.throughput.map((v,i)=>Math.min(102,v+Math.round(i*1.4)));
  state.data.network.kpis.depotProductivity.current=Math.min(115,state.data.network.kpis.depotProductivity.current+3.4);
  addActivity("Depot","BNE work rebalanced; projected outbound dwell reduced by 17 minutes.","low");
  addAudit("Depot agent","Rebalanced labour and outbound sequence at BNE",95);
  renderDepot();renderOverview();renderTrust();toast("Depot rebalanced","Labour and departure sequencing have been updated across five operating zones.");
}

function renderFleet() {
  if (!$("#optimize-charging").dataset.bound) {$("#optimize-charging").dataset.bound="1";$("#optimize-charging").addEventListener("click",optimizeCharging);}
  const fleet=state.data.fleet;
  const ready=fleet.filter(v=>v.routeFit==="Yes").length,totalAvoided=fleet.reduce((a,b)=>a+b.carbonAvoidedKg,0),cost=fleet.reduce((a,b)=>a+b.energyCost,0),avgHealth=fleet.reduce((a,b)=>a+b.batteryHealth,0)/fleet.length;
  $("#fleet-summary").innerHTML=[
    ["Route-ready EVs",`${ready}/${fleet.length}`,"Dispatch fit confirmed"],
    ["Battery health",`${avgHealth.toFixed(1)}%`,"Fleet average"],
    ["Planned energy cost",money(cost),"Current charge plan"],
    ["Carbon avoided",`${number(totalAvoided)} kg`,"Versus diesel equivalent"]
  ].map(x=>`<div class="summary-card"><span>${x[0]}</span><strong>${x[1]}</strong><small>${x[2]}</small></div>`).join("");
  $("#vehicle-list").innerHTML=fleet.map(v=>`<div class="vehicle-row"><div><strong>${v.vehicleId}</strong><small>${v.depot} depot</small></div><div class="soc-ring" style="--soc:${v.stateOfCharge}"><span>${v.stateOfCharge}%</span></div><div><strong>${v.rangeKm} km range</strong><small>${v.nextRouteKm} km next route</small></div><div><strong>${v.chargeWindow}</strong><small>${money(v.energyCost)} charge cost</small></div><span class="fit-chip ${v.routeFit==="Conditional"?"conditional":""}">${v.routeFit}</span></div>`).join("");
  renderChargingChart();
  $("#carbon-card").innerHTML=`<div><span>EMISSIONS AVOIDED BY CURRENT PLAN</span><strong>${number(totalAvoided)} kg CO₂e</strong><span>Equivalent to approximately ${number(totalAvoided/2.31)} litres of diesel.</span></div><b>↓6%</b>`;
}

function renderChargingChart() {
  const windows=["11–13","14–16","22–02","02–05"],counts=windows.map((_,i)=>state.data.fleet.filter(v=>v.chargeWindow.startsWith(windows[i].split("–")[0])).length);
  const tariffs=[38,32,19,16],w=420,h=280,p=36,max=Math.max(...counts,6);
  $("#charging-chart").innerHTML=`<svg viewBox="0 0 ${w} ${h}" width="100%" height="100%">${counts.map((c,i)=>{const bw=54,x=p+i*92+20,bh=c/max*150,y=205-bh;return `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="6" fill="#7ac143" opacity="${.55+i*.12}"/><text x="${x+bw/2}" y="${y-8}" text-anchor="middle" font-size="10" font-weight="bold">${c} EVs</text><text class="chart-label" x="${x+bw/2}" y="226" text-anchor="middle">${windows[i]}</text><text class="chart-label" x="${x+bw/2}" y="244" text-anchor="middle">${tariffs[i]}¢/kWh</text>`}).join("")}<line x1="${p}" x2="${w-p}" y1="205" y2="205" class="chart-grid"/><text x="${p}" y="18" font-size="8" fill="#6f7f89">VEHICLES SCHEDULED BY TARIFF WINDOW</text></svg>`;
}

function optimizeCharging() {
  state.data.fleet.forEach((v,i)=>{if(i%2===0)v.chargeWindow=i%4===0?"22:00–02:00":"02:00–05:00";v.energyCost=Number((v.energyCost*.82).toFixed(2));v.carbonAvoidedKg+=rand(8,24)});
  state.data.network.kpis.carbonPerShipment.current=Math.max(89,state.data.network.kpis.carbonPerShipment.current-1.8);
  addActivity("EV","Charge plan shifted to lower-tariff windows; cost and grid carbon reduced.","low");
  addAudit("EV agent","Optimised charge plan across active EV fleet",93);
  renderFleet();renderOverview();renderTrust();toast("Charge plan optimised","EVs were moved to safer, cheaper and lower-carbon charging windows.");
}

function renderScenarios() {
  if (!$("#scenario-grid").dataset.bound) {
    $("#scenario-grid").dataset.bound="1";
    $("#scenario-grid").addEventListener("click",e=>{const card=e.target.closest("[data-scenario]");if(card)applyScenario(card.dataset.scenario)});
    $("#reset-scenario").addEventListener("click",resetScenario);
  }
  $("#scenario-grid").innerHTML=state.data.scenarios.map(s=>`<article class="scenario-card ${state.activeScenario===s.id?"active":""}" data-scenario="${s.id}"><span>${s.icon}</span><h3>${s.name}</h3><p>${s.description}</p><button>Inject scenario →</button></article>`).join("");
  if (!state.activeScenario) {
    $("#scenario-stage").innerHTML=`<div class="scenario-placeholder"><span>◇</span><h3>Select a scenario to begin</h3><p>The control tower will calculate network exposure and an optimised response.</p></div>`;
  } else renderScenarioStage();
}

function applyScenario(id) {
  if (state.activeScenario) resetScenario(false);
  state.activeScenario=id;state.scenarioResponded=false;
  const s=state.data.scenarios.find(x=>x.id===id);
  Object.entries(s.impacts).forEach(([key,val])=>{if(state.data.network.kpis[key])state.data.network.kpis[key].current+=val});
  state.data.network.network.depots.forEach(d=>{if((id==="weather"&&d.id==="BNE")||(id==="congestion"&&d.id==="BNE")){d.load=94;d.status="critical"}});
  addActivity("Scenario",`${s.name} injected; network exposure is being recalculated.`,"high");
  renderScenarios();renderOverview();toast("Scenario injected",s.description,"warn");
}

function renderScenarioStage() {
  const s=state.data.scenarios.find(x=>x.id===state.activeScenario);
  const labels={lateExceptionRate:"Late exception rate",costToServe:"Cost-to-serve",depotProductivity:"Depot productivity",carbonPerShipment:"Carbon / shipment"};
  $("#scenario-stage").innerHTML=`<div class="scenario-active">
    <div class="scenario-brief"><span class="eyebrow" style="color:#7ac143">ACTIVE DISRUPTION</span><h2>${s.name}</h2><p>${s.description}</p><div class="impact-list">${Object.entries(s.impacts).map(([k,v])=>`<div class="impact-row"><span>${labels[k]}</span><b>${v>0?"+":""}${v.toFixed(1)}${k.includes("Rate")||k.includes("Productivity")?" pts":""}</b></div>`).join("")}</div><div class="scenario-progress"><i id="scenario-progress-bar" style="width:${state.scenarioResponded?"100%":"0%"}"></i></div><small>${state.scenarioResponded?"NETWORK RECOVERY COMPLETE":"AWAITING RESPONSE APPROVAL"}</small></div>
    <div class="response-plan"><span class="eyebrow">AIONOS RESPONSE PLAN</span><h3>Four coordinated actions protect service and margin</h3>${s.actions.map((a,i)=>`<div class="response-step"><span>${i+1}</span><div><strong>${a}</strong><small>Service, cost and operational policy checks passed</small></div><b>${92+i}% confidence</b></div>`).join("")}<div class="scenario-actions"><button class="btn btn-primary" id="approve-response" ${state.scenarioResponded?"disabled":""}>${state.scenarioResponded?"Response executed":"Approve coordinated response"}</button><button class="btn btn-secondary" id="scenario-evidence">View trade-offs</button></div></div>
  </div>`;
  $("#approve-response").addEventListener("click",respondScenario);
  $("#scenario-evidence").addEventListener("click",()=>openModal(`<span class="eyebrow">SCENARIO TRADE-OFFS</span><h2>${s.name}</h2><p>The recommended response was selected from 12 alternatives. It protects priority freight first, contains cost escalation and avoids unnecessary high-carbon mode swaps.</p><div class="modal-result"><div><small>SERVICE PROTECTED</small><strong>94%</strong></div><div><small>COST CONTAINED</small><strong>${money(184000)}</strong></div><div><small>RECEIVERS NOTIFIED</small><strong>${s.id==="disruption"?"126":"84"}</strong></div><div><small>POLICY CHECKS</small><strong>18/18</strong></div></div>`));
}

function respondScenario() {
  if (!state.activeScenario||state.scenarioResponded)return;
  const s=state.data.scenarios.find(x=>x.id===state.activeScenario);
  Object.entries(s.impacts).forEach(([key,val])=>{const m=state.data.network.kpis[key];if(m)m.current-=val*.82});
  state.data.network.network.depots.forEach(d=>{if(d.status==="critical"){d.load=Math.max(72,d.load-16);d.status="watch"}});
  state.scenarioResponded=true;
  addActivity("Scenario",`${s.name} response executed; 82% of projected KPI impact contained.`,"low");
  addAudit("Network orchestration agent",`Executed coordinated response for ${s.name}`,96);
  renderScenarios();renderOverview();renderTrust();
  requestAnimationFrame(()=>{$("#scenario-progress-bar").style.width="100%"});
  toast("Network response executed","The coordinated plan contained 82% of projected disruption impact.");
}

function resetScenario(render=true) {
  if (state.activeScenario) {
    state.data.network.kpis=clone(state.original.network.kpis);
    const preservedRevenue=state.data.leakage.filter(x=>x.status==="recovered").reduce((a,b)=>a+b.amount,0);
    state.data.network.kpis.revenueRecovered.current+=preservedRevenue;
    state.data.network.network.depots=clone(state.original.network.network.depots);
  }
  state.activeScenario=null;state.scenarioResponded=false;
  if(render){renderScenarios();renderOverview();toast("Scenario reset","Network returned to the current pilot baseline.");}
}

function renderTrust() {
  const agents=[
    ["Predictive ETA agent",96],["Exception orchestration agent",94],["Demand forecast agent",95],["Dynamic dispatch agent",93],["Revenue assurance agent",98],["Depot flow agent",92],["EV intelligence agent",91]
  ];
  $("#agent-performance").innerHTML=agents.map(a=>`<div class="agent-row"><strong>${a[0]}</strong><div class="agent-bar"><i style="width:${a[1]}%"></i></div><b>${a[1]}%</b></div>`).join("");
  $("#audit-list").innerHTML=state.audit.map(a=>`<div class="audit-item"><span>✓</span><div><strong>${a.agent}</strong><p>${a.action}</p><small>${a.confidence}% confidence · Human approved</small></div><small>${a.time}</small></div>`).join("");
}

function updateBadges() {
  $("#exception-badge").textContent=state.data.shipments.filter(s=>s.risk>=60&&!s.acted).length;
  $("#revenue-badge").textContent=state.data.leakage.filter(c=>c.status==="open").length;
}

function toggleSimulation() {
  state.simulationRunning=!state.simulationRunning;
  const btn=$("#simulation-toggle");
  btn.innerHTML=state.simulationRunning?"<span>■</span> Stop live simulation":"<span>▶</span> Start live simulation";
  if(state.simulationRunning){
    state.simulationTimer=setInterval(simulationTick,2600);
    toast("Live simulation started","Synthetic shipment, depot and revenue signals are now moving through the control loop.");
    simulationTick();
  }else{
    clearInterval(state.simulationTimer);state.simulationTimer=null;
    toast("Simulation paused","The current network state has been retained.");
  }
}

function simulationTick() {
  const types=["ETA","Demand","Revenue","Depot","EV","Dispatch"];
  const type=types[rand(0,types.length-1)];
  const messages={
    ETA:()=>{const s=state.data.shipments[rand(0,state.data.shipments.length-1)];const delta=rand(-5,8);s.risk=clamp(s.risk+delta,4,96);return `${s.id} risk ${delta>=0?"increased":"reduced"} to ${s.risk}% at ${s.status.toLowerCase()} handoff.`},
    Demand:()=>{const l=state.data.demand[rand(0,state.data.demand.length-1)];l.capacityUtilisation=clamp(l.capacityUtilisation+rand(-2,3),58,98);return `${l.lane} capacity now ${l.capacityUtilisation}%; forecast remains ${l.forecastAccuracy}% accurate.`},
    Revenue:()=>{const c=state.data.leakage.find(x=>x.status==="open");return c?`${c.caseId} evidence refreshed; ${money(c.amount)} remains recoverable.`:"No new billing leakage detected."},
    Depot:()=>{const z=state.data.depot.zones[rand(0,state.data.depot.zones.length-1)];z.load=clamp(z.load+rand(-3,4),42,98);return `${z.zone} load moved to ${z.load}%; next bottleneck forecast recalculated.`},
    EV:()=>{const v=state.data.fleet[rand(0,state.data.fleet.length-1)];return `${v.vehicleId} route-fit checked: ${v.rangeKm} km available for ${v.nextRouteKm} km plan.`},
    Dispatch:()=>{const r=state.data.routes[rand(0,state.data.routes.length-1)];return `${r.routeId} stop density refreshed; ${r.emptyKmBefore-r.emptyKmAfter} empty km avoidable.`}
  };
  const sev=type==="Revenue"||type==="ETA"?(Math.random()>.55?"medium":"low"):"low";
  addActivity(type,messages[type](),sev);
  renderExecutiveKpis();renderOutcomes();updateBadges();
  if(state.activePage==="exceptions")renderShipmentList();
  if(state.activePage==="demand")renderDemand();
  if(state.activePage==="depot")renderDepot();
}

async function runNetworkOptimisation() {
  const btn=$("#optimize-network");
  if(btn.disabled)return;
  btn.disabled=true;btn.innerHTML="<span>◌</span> Optimising…";
  toast("Network optimisation started","Agents are evaluating service, cost, cash, capacity and carbon trade-offs.");
  await wait(900);
  state.data.network.kpis.onTimePerformance.current=Math.min(97.2,state.data.network.kpis.onTimePerformance.current+1.4);
  state.data.network.kpis.lateExceptionRate.current=Math.max(7.1,state.data.network.kpis.lateExceptionRate.current-1.9);
  state.data.network.kpis.emptyKilometres.current=Math.max(88,state.data.network.kpis.emptyKilometres.current-3);
  state.data.network.kpis.costToServe.current=Math.max(82,state.data.network.kpis.costToServe.current-2.4);
  state.data.network.kpis.depotProductivity.current=Math.min(114,state.data.network.kpis.depotProductivity.current+2.1);
  state.data.network.kpis.carbonPerShipment.current=Math.max(90,state.data.network.kpis.carbonPerShipment.current-1.4);
  const recoverable=state.data.leakage.filter(x=>x.status==="open"&&x.confidence>=96).slice(0,2);
  recoverable.forEach(c=>c.status="recovered");
  const recovered=recoverable.reduce((a,b)=>a+b.amount,0);
  state.data.network.kpis.revenueRecovered.current+=recovered;
  state.data.shipments.filter(s=>s.risk>=70&&!s.acted).slice(0,3).forEach(s=>{s.risk-=28;s.etaConfidence=clamp(s.etaConfidence+15,0,99)});
  addActivity("Network",`Coordinated optimisation complete: service +1.4 pts, cost -2.4 pts, ${money(recovered)} recovered.`,"low");
  addAudit("Network orchestration agent","Executed network-wide optimisation cycle",97);
  renderAll();
  await wait(400);
  btn.disabled=false;btn.innerHTML="<span>✦</span> Run network optimisation";
  openModal(`<span class="eyebrow">OPTIMISATION COMPLETE</span><h2>One network action created four business outcomes.</h2><p>The control loop prioritised critical shipment interventions, balanced route capacity, reduced empty kilometres, shifted EV charging and approved high-confidence leakage recovery.</p><div class="modal-result"><div><small>SERVICE</small><strong>+1.4 pts</strong></div><div><small>COST</small><strong>-2.4 pts</strong></div><div><small>CASH</small><strong>${money(recovered)}</strong></div><div><small>CARBON</small><strong>-1.4 pts</strong></div></div><button class="btn btn-primary btn-block" onclick="document.getElementById('modal-close').click()">See updated network</button>`);
}

function rand(min,max){return Math.floor(Math.random()*(max-min+1))+min}
function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms))}

loadData().then(init).catch(error => {
  console.error(error);
  document.body.innerHTML = `<main style="font-family:Arial;padding:40px;max-width:720px;margin:auto"><h1>Unable to load the application data</h1><p>${error.message}</p><p>This static application must be served over HTTP. Run <code>python -m http.server 8080</code> in the repository folder, or deploy it through GitHub Pages.</p></main>`;
});

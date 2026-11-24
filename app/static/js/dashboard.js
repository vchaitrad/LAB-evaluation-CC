/**
 * Kubernetes Workload Distribution Monitor - Frontend Controller
 * Modern, High-Performance Dashboard with Real Kubernetes Live Data
 */

document.addEventListener("DOMContentLoaded", () => {
  // ==========================================
  // State Management
  // ==========================================
  const state = {
    theme: localStorage.getItem("k8s_theme") || "dark",
    refreshInterval: 10000,
    timerId: null,
    relativeTimeTimerId: null,
    lastUpdatedTimestamp: null,
    dashboardData: null,
    charts: {
      workloadDoughnut: null,
      workloadBar: null,
      nodeCpu: null,
      nodeMem: null,
      podResources: null
    }
  };

  // ==========================================
  // DOM Element References
  // ==========================================
  const elements = {
    html: document.documentElement,
    themeToggleBtn: document.getElementById("themeToggleBtn"),
    themeIconDark: document.getElementById("themeIconDark"),
    themeIconLight: document.getElementById("themeIconLight"),
    manualRefreshBtn: document.getElementById("manualRefreshBtn"),
    refreshIcon: document.getElementById("refreshIcon"),
    refreshIntervalSelect: document.getElementById("refreshInterval"),
    lastUpdatedText: document.getElementById("lastUpdatedText"),
    menuToggle: document.getElementById("menuToggle"),
    sidebar: document.getElementById("sidebar"),

    // Overview
    statTotalNodes: document.getElementById("statTotalNodes"),
    statReadyNodes: document.getElementById("statReadyNodes"),
    statNotReadyNodes: document.getElementById("statNotReadyNodes"),
    statTotalPods: document.getElementById("statTotalPods"),
    statRunningPods: document.getElementById("statRunningPods"),
    statPendingPods: document.getElementById("statPendingPods"),
    statFailedPods: document.getElementById("statFailedPods"),
    statDeploymentReplicas: document.getElementById("statDeploymentReplicas"),
    statDesiredReplicas: document.getElementById("statDesiredReplicas"),
    statAvailableReplicas: document.getElementById("statAvailableReplicas"),
    statMetricsStatus: document.getElementById("statMetricsStatus"),
    metricsStatusPill: document.getElementById("metricsStatusPill"),
    topbarClusterBadge: document.getElementById("topbarClusterBadge"),

    // Nodes
    nodesCardsContainer: document.getElementById("nodesCardsContainer"),

    // Workload
    workloadSummaryRow: document.getElementById("workloadSummaryRow"),
    workloadTotalBadge: document.getElementById("workloadTotalBadge"),

    // Pods
    podSearchInput: document.getElementById("podSearchInput"),
    podsTableBody: document.getElementById("podsTableBody"),
    podTableCount: document.getElementById("podTableCount"),

    // Resources
    metricsNoticeBanner: document.getElementById("metricsNoticeBanner"),

    // Health
    testAppBtn: document.getElementById("testAppBtn"),
    testBurstBtn: document.getElementById("testBurstBtn"),
    healthConsoleStatus: document.getElementById("healthConsoleStatus"),
    healthConsolePod: document.getElementById("healthConsolePod"),
    healthConsoleLatency: document.getElementById("healthConsoleLatency"),
    healthConsoleJson: document.getElementById("healthConsoleJson")
  };

  // ==========================================
  // Theme Management
  // ==========================================
  function applyTheme(theme) {
    state.theme = theme;
    elements.html.setAttribute("data-theme", theme);
    localStorage.setItem("k8s_theme", theme);

    if (theme === "dark") {
      elements.themeIconDark.style.display = "block";
      elements.themeIconLight.style.display = "none";
    } else {
      elements.themeIconDark.style.display = "none";
      elements.themeIconLight.style.display = "block";
    }

    // Refresh charts on theme switch to update font & grid colors
    updateChartTheme();
  }

  elements.themeToggleBtn.addEventListener("click", () => {
    applyTheme(state.theme === "dark" ? "light" : "dark");
  });

  applyTheme(state.theme);

  // Mobile sidebar toggle
  if (elements.menuToggle && elements.sidebar) {
    elements.menuToggle.addEventListener("click", () => {
      elements.sidebar.classList.toggle("open");
    });
  }

  // ==========================================
  // Navigation Active State Tracking
  // ==========================================
  const navItems = document.querySelectorAll(".nav-item");
  const sections = document.querySelectorAll("section[id]");

  window.addEventListener("scroll", () => {
    let current = "";
    sections.forEach((sec) => {
      const top = sec.offsetTop - 120;
      if (window.scrollY >= top) {
        current = sec.getAttribute("id");
      }
    });

    navItems.forEach((item) => {
      item.classList.remove("active");
      if (item.getAttribute("data-nav") === current) {
        item.classList.add("active");
      }
    });
  });

  // ==========================================
  // Chart Helpers & Theme Colors
  // ==========================================
  function getChartColors() {
    const isDark = state.theme === "dark";
    return {
      textColor: isDark ? "#94a3b8" : "#64748b",
      gridColor: isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.06)",
      doughnutColors: ["#6366f1", "#06b6d4", "#a855f7", "#ec4899", "#3b82f6"],
      doughnutHover: ["#4f46e5", "#0891b2", "#9333ea", "#db2777", "#2563eb"],
      barPrimary: "#6366f1",
      barSecondary: "#06b6d4"
    };
  }

  function updateChartTheme() {
    const colors = getChartColors();
    Object.values(state.charts).forEach((chart) => {
      if (chart) {
        if (chart.options.scales) {
          if (chart.options.scales.x) {
            chart.options.scales.x.ticks.color = colors.textColor;
            chart.options.scales.x.grid.color = colors.gridColor;
          }
          if (chart.options.scales.y) {
            chart.options.scales.y.ticks.color = colors.textColor;
            chart.options.scales.y.grid.color = colors.gridColor;
          }
        }
        if (chart.options.plugins && chart.options.plugins.legend) {
          chart.options.plugins.legend.labels.color = colors.textColor;
        }
        chart.update();
      }
    });
  }

  // ==========================================
  // Render Overview Section
  // ==========================================
  function renderOverview(overview, metricsAvailable, clusterName) {
    if (!overview) return;

    elements.statTotalNodes.textContent = overview.total_nodes;
    elements.statReadyNodes.textContent = overview.ready_nodes;
    elements.statNotReadyNodes.textContent = overview.total_nodes - overview.ready_nodes;

    elements.statTotalPods.textContent = overview.total_pods;
    elements.statRunningPods.textContent = overview.running_pods;
    elements.statPendingPods.textContent = overview.pending_pods;
    elements.statFailedPods.textContent = overview.failed_pods;

    if (overview.pending_pods > 0) {
      elements.statPendingPods.parentElement.classList.remove("badge-muted");
      elements.statPendingPods.parentElement.classList.add("badge-warning");
    }
    if (overview.failed_pods > 0) {
      elements.statFailedPods.parentElement.classList.remove("badge-muted");
      elements.statFailedPods.parentElement.classList.add("badge-danger");
    }

    const dep = overview.deployment || {};
    elements.statDeploymentReplicas.textContent = `${dep.ready || 0} / ${dep.desired || 0}`;
    elements.statDesiredReplicas.textContent = dep.desired || 0;
    elements.statAvailableReplicas.textContent = dep.available || 0;

    if (metricsAvailable) {
      elements.statMetricsStatus.textContent = "Online";
      elements.metricsStatusPill.textContent = "Live Telemetry";
      elements.metricsStatusPill.className = "badge badge-success";
      elements.metricsNoticeBanner.style.display = "none";
    } else {
      elements.statMetricsStatus.textContent = "Unavailable";
      elements.metricsStatusPill.textContent = "Metrics N/A";
      elements.metricsStatusPill.className = "badge badge-warning";
      elements.metricsNoticeBanner.style.display = "flex";
    }

    if (clusterName) {
      elements.topbarClusterBadge.textContent = `Cluster: ${clusterName}`;
    }
  }

  // ==========================================
  // Render Node Monitoring Cards
  // ==========================================
  function renderNodeCards(nodes, metricsAvailable) {
    if (!nodes || nodes.length === 0) {
      elements.nodesCardsContainer.innerHTML = `
        <div class="card" style="grid-column: 1/-1; text-align:center; padding:30px; color:var(--text-muted);">
          No nodes discovered in cluster.
        </div>`;
      return;
    }

    // Sort: Control Plane first, then Worker 1, Worker 2, etc.
    const sortedNodes = [...nodes].sort((a, b) => {
      if (a.role_type === "control-plane") return -1;
      if (b.role_type === "control-plane") return 1;
      return a.name.localeCompare(b.name);
    });

    let html = "";
    sortedNodes.forEach((node, idx) => {
      const isControlPlane = node.role_type === "control-plane";
      const roleBadgeClass = isControlPlane ? "role-control-plane" : "role-worker";
      const displayName = isControlPlane ? "Control Plane" : `Worker ${idx} (${node.name})`;

      // Status Pill
      const statusPill = node.is_ready
        ? `<span class="badge badge-success"><span style="width:6px; height:6px; border-radius:50%; background:#10b981; display:inline-block; margin-right:4px;"></span>Ready</span>`
        : `<span class="badge badge-danger">Not Ready</span>`;

      // CPU Values
      const cpuUsage = node.cpu_usage_m !== null ? `${node.cpu_usage_m}m` : "N/A";
      const cpuPct = node.cpu_usage_pct !== null ? `${node.cpu_usage_pct}%` : "N/A";
      const cpuBarWidth = node.cpu_usage_pct !== null ? Math.min(node.cpu_usage_pct, 100) : 0;

      // Memory Values
      const memUsage = node.memory_usage_mib !== null ? `${node.memory_usage_mib} MiB` : "N/A";
      const memPct = node.memory_usage_pct !== null ? `${node.memory_usage_pct}%` : "N/A";
      const memBarWidth = node.memory_usage_pct !== null ? Math.min(node.memory_usage_pct, 100) : 0;

      html += `
        <div class="card node-card">
          <div class="node-card-header">
            <div class="node-name-group">
              <span class="node-name">${node.name}</span>
              <span class="node-role-badge ${roleBadgeClass}">${node.role}</span>
            </div>
            <div>${statusPill}</div>
          </div>

          <div class="node-metrics">
            <!-- CPU Progress -->
            <div class="metric-bar-group">
              <div class="metric-bar-label">
                <span>CPU Utilization</span>
                <strong>${cpuUsage} (${cpuPct})</strong>
              </div>
              <div class="metric-bar-track">
                <div class="metric-bar-fill fill-cpu" style="width: ${cpuBarWidth}%;"></div>
              </div>
            </div>

            <!-- Memory Progress -->
            <div class="metric-bar-group">
              <div class="metric-bar-label">
                <span>Memory Utilization</span>
                <strong>${memUsage} (${memPct})</strong>
              </div>
              <div class="metric-bar-track">
                <div class="metric-bar-fill fill-mem" style="width: ${memBarWidth}%;"></div>
              </div>
            </div>
          </div>

          <div class="node-meta-grid">
            <div class="meta-item">
              <span class="meta-label">App Pods Running</span>
              <span class="meta-value" style="color:var(--primary); font-size:1.05rem;">${node.app_pods_count} Pods</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Internal IP</span>
              <span class="meta-value">${node.internal_ip}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Allocatable CPU</span>
              <span class="meta-value">${node.allocatable_cpu_cores} Cores</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Allocatable RAM</span>
              <span class="meta-value">${node.allocatable_mem_mib} MiB</span>
            </div>
            <div class="meta-item" style="grid-column: 1/-1;">
              <span class="meta-label">Kubelet Version / OS</span>
              <span class="meta-value" style="font-size:0.75rem;">${node.kubelet_version} (${node.os_image})</span>
            </div>
          </div>
        </div>
      `;
    });

    elements.nodesCardsContainer.innerHTML = html;
  }

  // ==========================================
  // Render Workload Distribution
  // ==========================================
  function renderWorkloadDistribution(workload) {
    if (!workload) return;

    elements.workloadTotalBadge.textContent = `Total: ${workload.total_app_pods} Pods`;

    // Summary pills
    let summaryHtml = "";
    const workers = workload.workers || [];

    workers.forEach((w) => {
      summaryHtml += `
        <div class="workload-worker-stat">
          <span style="font-size:0.8rem; color:var(--text-muted); font-weight:600;">${w.worker_label}</span>
          <div style="display:flex; align-items:baseline; justify-content:space-between; margin-top:4px;">
            <span style="font-size:1.5rem; font-weight:800; color:var(--text-primary);">${w.pod_count} Pods</span>
            <span class="badge badge-primary" style="font-size:0.88rem;">${w.percentage}%</span>
          </div>
        </div>
      `;
    });

    elements.workloadSummaryRow.innerHTML = summaryHtml;

    // Charts update
    const labels = workers.map((w) => w.worker_label.split(" (")[0]);
    const counts = workers.map((w) => w.pod_count);
    const percentages = workers.map((w) => w.percentage);
    const colors = getChartColors();

    // 1. Doughnut Chart (Percentage)
    const ctxDoughnut = document.getElementById("workloadDoughnutChart").getContext("2d");
    if (state.charts.workloadDoughnut) {
      state.charts.workloadDoughnut.data.labels = labels;
      state.charts.workloadDoughnut.data.datasets[0].data = percentages;
      state.charts.workloadDoughnut.update();
    } else {
      state.charts.workloadDoughnut = new Chart(ctxDoughnut, {
        type: "doughnut",
        data: {
          labels: labels,
          datasets: [
            {
              data: percentages,
              backgroundColor: colors.doughnutColors,
              hoverBackgroundColor: colors.doughnutHover,
              borderWidth: 2,
              borderColor: state.theme === "dark" ? "#1a2234" : "#ffffff"
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "bottom",
              labels: {
                color: colors.textColor,
                padding: 16,
                font: { size: 12, weight: "bold" }
              }
            },
            tooltip: {
              callbacks: {
                label: (ctx) => ` ${ctx.label}: ${ctx.raw}% (${counts[ctx.dataIndex]} Pods)`
              }
            }
          },
          cutout: "68%"
        }
      });
    }

    // 2. Bar Chart (Pod Count)
    const ctxBar = document.getElementById("workloadBarChart").getContext("2d");
    if (state.charts.workloadBar) {
      state.charts.workloadBar.data.labels = labels;
      state.charts.workloadBar.data.datasets[0].data = counts;
      state.charts.workloadBar.update();
    } else {
      state.charts.workloadBar = new Chart(ctxBar, {
        type: "bar",
        data: {
          labels: labels,
          datasets: [
            {
              label: "Pods Allocated",
              data: counts,
              backgroundColor: colors.doughnutColors.slice(0, labels.length),
              borderRadius: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { stepSize: 1, color: colors.textColor },
              grid: { color: colors.gridColor }
            },
            x: {
              ticks: { color: colors.textColor },
              grid: { display: false }
            }
          }
        }
      });
    }
  }

  // ==========================================
  // Render Pod Management Table
  // ==========================================
  let cachedPods = [];

  function renderPodsTable(pods) {
    if (!pods) return;
    cachedPods = pods;
    filterAndDisplayPods();
  }

  function filterAndDisplayPods() {
    const query = (elements.podSearchInput.value || "").toLowerCase().trim();
    const filtered = cachedPods.filter((p) => {
      return (
        p.name.toLowerCase().includes(query) ||
        p.node_name.toLowerCase().includes(query) ||
        p.status.toLowerCase().includes(query) ||
        p.pod_ip.toLowerCase().includes(query)
      );
    });

    elements.podTableCount.textContent = `Showing ${filtered.length} of ${cachedPods.length} pods`;

    if (filtered.length === 0) {
      elements.podsTableBody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align:center; padding:30px; color:var(--text-muted);">
            No matching application pods found.
          </td>
        </tr>`;
      return;
    }

    let html = "";
    filtered.forEach((pod) => {
      const statusClass =
        pod.status === "Running"
          ? "badge-success"
          : pod.status === "Pending"
          ? "badge-warning"
          : "badge-danger";

      const restartBadge =
        pod.restart_count > 0
          ? `<span class="badge badge-warning">${pod.restart_count}</span>`
          : `<span class="badge badge-muted">0</span>`;

      const cpuText = pod.cpu_m !== null ? `${pod.cpu_m}m` : "N/A";
      const memText = pod.memory_mib !== null ? `${pod.memory_mib} MiB` : "N/A";

      html += `
        <tr>
          <td class="pod-name-cell">
            <span title="${pod.name}">${pod.name}</span>
          </td>
          <td><span class="badge ${statusClass}">${pod.status}</span></td>
          <td><span class="badge badge-primary">${pod.ready_str}</span></td>
          <td style="font-family:ui-monospace, monospace;">${pod.pod_ip}</td>
          <td><span style="font-weight:600; color:var(--text-primary);">${pod.node_name}</span></td>
          <td>${restartBadge}</td>
          <td><span style="color:#38bdf8; font-weight:600;">${cpuText}</span></td>
          <td><span style="color:#c084fc; font-weight:600;">${memText}</span></td>
        </tr>
      `;
    });

    elements.podsTableBody.innerHTML = html;
  }

  elements.podSearchInput.addEventListener("input", filterAndDisplayPods);

  // ==========================================
  // Render Resource Monitoring Charts
  // ==========================================
  function renderResourceCharts(nodes, pods, metricsAvailable) {
    const colors = getChartColors();

    if (!nodes || nodes.length === 0) return;

    // 1. Node CPU Usage Chart
    const nodeLabels = nodes.map((n) => n.name.replace("workload-cluster-", ""));
    const nodeCpuData = nodes.map((n) => (n.cpu_usage_m !== null ? n.cpu_usage_m : 0));
    const nodeMemData = nodes.map((n) => (n.memory_usage_mib !== null ? n.memory_usage_mib : 0));

    const ctxNodeCpu = document.getElementById("nodeCpuChart").getContext("2d");
    if (state.charts.nodeCpu) {
      state.charts.nodeCpu.data.labels = nodeLabels;
      state.charts.nodeCpu.data.datasets[0].data = nodeCpuData;
      state.charts.nodeCpu.update();
    } else {
      state.charts.nodeCpu = new Chart(ctxNodeCpu, {
        type: "bar",
        data: {
          labels: nodeLabels,
          datasets: [
            {
              label: "CPU (millicores)",
              data: nodeCpuData,
              backgroundColor: "#3b82f6",
              borderRadius: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { color: colors.textColor },
              grid: { color: colors.gridColor }
            },
            x: {
              ticks: { color: colors.textColor },
              grid: { display: false }
            }
          }
        }
      });
    }

    // 2. Node Memory Usage Chart
    const ctxNodeMem = document.getElementById("nodeMemChart").getContext("2d");
    if (state.charts.nodeMem) {
      state.charts.nodeMem.data.labels = nodeLabels;
      state.charts.nodeMem.data.datasets[0].data = nodeMemData;
      state.charts.nodeMem.update();
    } else {
      state.charts.nodeMem = new Chart(ctxNodeMem, {
        type: "bar",
        data: {
          labels: nodeLabels,
          datasets: [
            {
              label: "Memory (MiB)",
              data: nodeMemData,
              backgroundColor: "#8b5cf6",
              borderRadius: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { color: colors.textColor },
              grid: { color: colors.gridColor }
            },
            x: {
              ticks: { color: colors.textColor },
              grid: { display: false }
            }
          }
        }
      });
    }

    // 3. Application Pod Resource Chart
    if (pods && pods.length > 0) {
      const podLabels = pods.map((p) => p.name.split("-").slice(-1)[0]);
      const podCpuData = pods.map((p) => (p.cpu_m !== null ? p.cpu_m : 0));
      const podMemData = pods.map((p) => (p.memory_mib !== null ? p.memory_mib : 0));

      const ctxPodRes = document.getElementById("podResourceChart").getContext("2d");
      if (state.charts.podResources) {
        state.charts.podResources.data.labels = podLabels;
        state.charts.podResources.data.datasets[0].data = podCpuData;
        state.charts.podResources.data.datasets[1].data = podMemData;
        state.charts.podResources.update();
      } else {
        state.charts.podResources = new Chart(ctxPodRes, {
          type: "bar",
          data: {
            labels: podLabels,
            datasets: [
              {
                label: "Pod CPU (m)",
                data: podCpuData,
                backgroundColor: "#06b6d4",
                borderRadius: 4
              },
              {
                label: "Pod Memory (MiB)",
                data: podMemData,
                backgroundColor: "#ec4899",
                borderRadius: 4
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                labels: { color: colors.textColor }
              }
            },
            scales: {
              y: {
                beginAtZero: true,
                ticks: { color: colors.textColor },
                grid: { color: colors.gridColor }
              },
              x: {
                ticks: { color: colors.textColor },
                grid: { display: false }
              }
            }
          }
        });
      }
    }
  }

  // ==========================================
  // Application Health Test Controls
  // ==========================================
  async function performHealthTest() {
    elements.testAppBtn.disabled = true;
    elements.healthConsoleStatus.textContent = "Probing application...";
    elements.healthConsoleStatus.style.color = "#f59e0b";

    try {
      const resp = await fetch("/api/test-app");
      const result = await resp.json();

      if (result.http_code === 200 && result.status === "healthy") {
        elements.healthConsoleStatus.textContent = `200 OK (${result.status})`;
        elements.healthConsoleStatus.style.color = "#10b981";
      } else {
        elements.healthConsoleStatus.textContent = `HTTP ${result.http_code} (${result.status})`;
        elements.healthConsoleStatus.style.color = "#ef4444";
      }

      elements.healthConsolePod.textContent = result.responding_pod || "N/A";
      elements.healthConsoleLatency.textContent = `${result.latency_ms} ms`;
      elements.healthConsoleJson.textContent = JSON.stringify(result, null, 2);
    } catch (err) {
      elements.healthConsoleStatus.textContent = "Error testing application";
      elements.healthConsoleStatus.style.color = "#ef4444";
      elements.healthConsoleJson.textContent = `Failed to connect to application test endpoint: ${err.message}`;
    } finally {
      elements.testAppBtn.disabled = false;
    }
  }

  async function performBurstTest() {
    elements.testBurstBtn.disabled = true;
    elements.healthConsoleStatus.textContent = "Sending 5 requests to test workload balancing...";
    elements.healthConsoleStatus.style.color = "#f59e0b";

    const results = [];
    for (let i = 1; i <= 5; i++) {
      try {
        const resp = await fetch("/api/test-app");
        const json = await resp.json();
        results.push({
          request: i,
          status: json.status,
          latency: `${json.latency_ms}ms`,
          responding_pod: json.responding_pod
        });
      } catch (e) {
        results.push({ request: i, error: e.message });
      }
    }

    elements.healthConsoleStatus.textContent = "Completed 5 probes successfully";
    elements.healthConsoleStatus.style.color = "#10b981";
    elements.healthConsolePod.textContent = "Multiple Pods Responded";
    elements.healthConsoleLatency.textContent = "Batch test";
    elements.healthConsoleJson.textContent = JSON.stringify(results, null, 2);
    elements.testBurstBtn.disabled = false;
  }

  elements.testAppBtn.addEventListener("click", performHealthTest);
  elements.testBurstBtn.addEventListener("click", performBurstTest);

  // ==========================================
  // Dashboard Fetch & Refresh Engine
  // ==========================================
  async function fetchDashboardData(isManual = false) {
    if (isManual) {
      elements.refreshIcon.classList.add("spin");
      elements.manualRefreshBtn.disabled = true;
    }

    try {
      const response = await fetch("/api/all-data");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      state.dashboardData = data;
      state.lastUpdatedTimestamp = new Date();

      renderOverview(data.overview, data.metrics_available, data.cluster_name);
      renderNodeCards(data.nodes, data.metrics_available);
      renderWorkloadDistribution(data.workload_distribution);
      renderPodsTable(data.pods);
      renderResourceCharts(data.nodes, data.pods, data.metrics_available);

      updateRelativeTimestamp();
    } catch (err) {
      console.error("Dashboard update failed:", err);
      elements.lastUpdatedText.textContent = `Error updating (${err.message})`;
    } finally {
      if (isManual) {
        setTimeout(() => {
          elements.refreshIcon.classList.remove("spin");
          elements.manualRefreshBtn.disabled = false;
        }, 400);
      }
    }
  }

  function updateRelativeTimestamp() {
    if (!state.lastUpdatedTimestamp) return;
    const elapsedSeconds = Math.round((new Date() - state.lastUpdatedTimestamp) / 1000);
    if (elapsedSeconds < 2) {
      elements.lastUpdatedText.textContent = "Updated just now";
    } else {
      elements.lastUpdatedText.textContent = `Updated ${elapsedSeconds}s ago`;
    }
  }

  // Auto-refresh interval handler
  function setupAutoRefresh(intervalMs) {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }

    state.refreshInterval = intervalMs;
    if (intervalMs > 0) {
      state.timerId = setInterval(() => {
        fetchDashboardData(false);
      }, intervalMs);
    }
  }

  elements.refreshIntervalSelect.addEventListener("change", (e) => {
    const val = parseInt(e.target.value, 10);
    setupAutoRefresh(val);
  });

  elements.manualRefreshBtn.addEventListener("click", () => {
    fetchDashboardData(true);
  });

  // Relative timer ticker every 1s
  state.relativeTimeTimerId = setInterval(updateRelativeTimestamp, 1000);

  // Initial load
  fetchDashboardData(true);
  setupAutoRefresh(state.refreshInterval);
});

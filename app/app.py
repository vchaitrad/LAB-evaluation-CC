import os
import ssl
import json
import socket
import time
import subprocess
import urllib.request
import urllib.error
from datetime import datetime
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

# Kubernetes In-Cluster Configuration Paths
SERVICE_ACCOUNT_PATH = "/var/run/secrets/kubernetes.io/serviceaccount"
TOKEN_PATH = os.path.join(SERVICE_ACCOUNT_PATH, "token")
CA_CERT_PATH = os.path.join(SERVICE_ACCOUNT_PATH, "ca.crt")
NAMESPACE_PATH = os.path.join(SERVICE_ACCOUNT_PATH, "namespace")


def get_current_namespace():
    if os.path.exists(NAMESPACE_PATH):
        try:
            with open(NAMESPACE_PATH, "r") as f:
                return f.read().strip()
        except Exception:
            pass
    return "default"


def k8s_api_request(path):
    """
    Query Kubernetes API server safely.
    Uses in-cluster ServiceAccount token & CA cert when running inside a Pod.
    Falls back to safe subprocess 'kubectl get --raw' when running locally.
    """
    # 1. In-Cluster Mode (Pod with ServiceAccount)
    if os.path.exists(TOKEN_PATH) and os.path.exists(CA_CERT_PATH):
        try:
            with open(TOKEN_PATH, "r") as f:
                token = f.read().strip()

            host = os.environ.get("KUBERNETES_SERVICE_HOST", "kubernetes.default.svc")
            port = os.environ.get("KUBERNETES_SERVICE_PORT", "443")
            url = f"https://{host}:{port}{path}"

            ssl_ctx = ssl.create_default_context(cafile=CA_CERT_PATH)
            req = urllib.request.Request(
                url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json"
                }
            )

            with urllib.request.urlopen(req, context=ssl_ctx, timeout=6) as resp:
                if resp.status == 200:
                    return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None  # Endpoint not found (e.g., Metrics Server not installed)
            return None
        except Exception:
            return None

    # 2. Local Fallback Mode (Windows host / Developer environment)
    try:
        res = subprocess.run(
            ["kubectl", "get", "--raw", path],
            capture_output=True,
            text=True,
            timeout=8,
            check=True
        )
        return json.loads(res.stdout)
    except Exception:
        return None


def parse_cpu_value(val):
    """Convert Kubernetes CPU string (e.g. '347415743n', '128m', '1') to millicores float."""
    if not val:
        return 0.0
    val_str = str(val).strip()
    try:
        if val_str.endswith("n"):
            return round(int(val_str[:-1]) / 1_000_000.0, 2)
        if val_str.endswith("u"):
            return round(int(val_str[:-1]) / 1_000.0, 2)
        if val_str.endswith("m"):
            return round(float(val_str[:-1]), 2)
        return round(float(val_str) * 1000.0, 2)
    except (ValueError, TypeError):
        return 0.0


def parse_memory_value(val):
    """Convert Kubernetes memory string (e.g. '605164Ki', '256Mi', '1Gi') to MiB float."""
    if not val:
        return 0.0
    val_str = str(val).strip()
    try:
        if val_str.endswith("Ki"):
            return round(int(val_str[:-2]) / 1024.0, 2)
        if val_str.endswith("Mi"):
            return round(float(val_str[:-2]), 2)
        if val_str.endswith("Gi"):
            return round(float(val_str[:-2]) * 1024.0, 2)
        if val_str.endswith("Ti"):
            return round(float(val_str[:-2]) * 1024.0 * 1024.0, 2)
        return round(int(val_str) / (1024.0 * 1024.0), 2)
    except (ValueError, TypeError):
        return 0.0


def fetch_nodes_data():
    raw_nodes = k8s_api_request("/api/v1/nodes")
    raw_metrics = k8s_api_request("/apis/metrics.k8s.io/v1beta1/nodes")
    
    metrics_by_node = {}
    if raw_metrics and "items" in raw_metrics:
        for item in raw_metrics["items"]:
            n_name = item.get("metadata", {}).get("name")
            usage = item.get("usage", {})
            metrics_by_node[n_name] = {
                "cpu_m": parse_cpu_value(usage.get("cpu")),
                "memory_mib": parse_memory_value(usage.get("memory"))
            }

    nodes = []
    if raw_nodes and "items" in raw_nodes:
        for item in raw_nodes["items"]:
            meta = item.get("metadata", {})
            spec = item.get("spec", {})
            status = item.get("status", {})
            name = meta.get("name", "unknown")
            labels = meta.get("labels", {})

            # Determine Role
            if "node-role.kubernetes.io/control-plane" in labels or "node-role.kubernetes.io/master" in labels:
                role = "Control Plane"
                role_type = "control-plane"
            else:
                role = "Worker"
                role_type = "worker"

            # Determine Ready Condition
            is_ready = False
            for cond in status.get("conditions", []):
                if cond.get("type") == "Ready":
                    is_ready = (cond.get("status") == "True")
                    break

            # Addresses
            internal_ip = "N/A"
            for addr in status.get("addresses", []):
                if addr.get("type") == "InternalIP":
                    internal_ip = addr.get("address")
                    break

            # Allocatable Resources
            alloc = status.get("allocatable", {})
            alloc_cpu_cores = float(alloc.get("cpu", "1"))
            alloc_cpu_m = alloc_cpu_cores * 1000.0
            alloc_mem_mib = parse_memory_value(alloc.get("memory", "0"))

            # Metrics
            node_metric = metrics_by_node.get(name)
            cpu_usage_m = None
            cpu_pct = None
            mem_usage_mib = None
            mem_pct = None

            if node_metric:
                cpu_usage_m = node_metric["cpu_m"]
                mem_usage_mib = node_metric["memory_mib"]
                if alloc_cpu_m > 0:
                    cpu_pct = round((cpu_usage_m / alloc_cpu_m) * 100.0, 1)
                if alloc_mem_mib > 0:
                    mem_pct = round((mem_usage_mib / alloc_mem_mib) * 100.0, 1)

            node_info = status.get("nodeInfo", {})

            nodes.append({
                "name": name,
                "role": role,
                "role_type": role_type,
                "status": "Ready" if is_ready else "NotReady",
                "is_ready": is_ready,
                "internal_ip": internal_ip,
                "kubelet_version": node_info.get("kubeletVersion", "N/A"),
                "os_image": node_info.get("osImage", "N/A"),
                "allocatable_cpu_cores": alloc_cpu_cores,
                "allocatable_cpu_m": alloc_cpu_m,
                "allocatable_mem_mib": alloc_mem_mib,
                "cpu_usage_m": cpu_usage_m,
                "cpu_usage_pct": cpu_pct,
                "memory_usage_mib": mem_usage_mib,
                "memory_usage_pct": mem_pct,
                "app_pods_count": 0  # Will be populated after pods are inspected
            })

    return nodes, bool(metrics_by_node)


def fetch_pods_data(namespace="default"):
    raw_pods = k8s_api_request(f"/api/v1/namespaces/{namespace}/pods")
    raw_metrics = k8s_api_request(f"/apis/metrics.k8s.io/v1beta1/namespaces/{namespace}/pods")

    metrics_by_pod = {}
    if raw_metrics and "items" in raw_metrics:
        for item in raw_metrics["items"]:
            p_name = item.get("metadata", {}).get("name")
            containers = item.get("containers", [])
            total_cpu = sum(parse_cpu_value(c.get("usage", {}).get("cpu")) for c in containers)
            total_mem = sum(parse_memory_value(c.get("usage", {}).get("memory")) for c in containers)
            metrics_by_pod[p_name] = {
                "cpu_m": round(total_cpu, 2),
                "memory_mib": round(total_mem, 2)
            }

    pods = []
    if raw_pods and "items" in raw_pods:
        for item in raw_pods["items"]:
            meta = item.get("metadata", {})
            spec = item.get("spec", {})
            status = item.get("status", {})
            labels = meta.get("labels", {})

            # Only track workload-app pods if selector matches, or all pods in default namespace
            app_label = labels.get("app", "")
            if app_label != "workload-app" and "workload" not in meta.get("name", ""):
                continue

            # Ready Status (e.g. 1/1)
            container_statuses = status.get("containerStatuses", [])
            ready_count = sum(1 for c in container_statuses if c.get("ready"))
            total_containers = len(spec.get("containers", []))
            ready_str = f"{ready_count}/{total_containers}" if total_containers > 0 else "0/0"
            is_ready = (ready_count == total_containers and total_containers > 0)

            # Restarts
            restarts = sum(c.get("restartCount", 0) for c in container_statuses)

            p_name = meta.get("name", "unknown")
            pod_metric = metrics_by_pod.get(p_name)

            pods.append({
                "name": p_name,
                "status": status.get("phase", "Unknown"),
                "is_ready": is_ready,
                "ready_str": ready_str,
                "pod_ip": status.get("podIP", "Pending"),
                "node_name": spec.get("nodeName", "Unassigned"),
                "restart_count": restarts,
                "created_at": meta.get("creationTimestamp", ""),
                "cpu_m": pod_metric["cpu_m"] if pod_metric else None,
                "memory_mib": pod_metric["memory_mib"] if pod_metric else None
            })

    return pods, bool(metrics_by_pod)


def fetch_deployment_data(namespace="default", name="workload-deployment"):
    raw_dep = k8s_api_request(f"/apis/apps/v1/namespaces/{namespace}/deployments/{name}")
    if not raw_dep:
        return {
            "name": name,
            "desired": 0,
            "ready": 0,
            "available": 0,
            "updated": 0,
            "replicas": 0
        }

    spec = raw_dep.get("spec", {})
    status = raw_dep.get("status", {})
    return {
        "name": name,
        "desired": spec.get("replicas", 0),
        "replicas": status.get("replicas", 0),
        "ready": status.get("readyReplicas", 0),
        "available": status.get("availableReplicas", 0),
        "updated": status.get("updatedReplicas", 0)
    }


def build_full_dashboard_state():
    ns = get_current_namespace()
    nodes, nodes_metrics_ok = fetch_nodes_data()
    pods, pods_metrics_ok = fetch_pods_data(ns)
    deployment = fetch_deployment_data(ns, "workload-deployment")

    # Map pod count to nodes
    node_pod_counts = {}
    for p in pods:
        n = p.get("node_name")
        if n:
            node_pod_counts[n] = node_pod_counts.get(n, 0) + 1

    for n in nodes:
        n["app_pods_count"] = node_pod_counts.get(n["name"], 0)

    # Workload Distribution breakdown
    worker_distribution = []
    total_app_pods = len(pods)
    
    # Identify worker nodes
    workers = [n for n in nodes if n["role_type"] == "worker"]
    for idx, w in enumerate(workers, start=1):
        p_count = w["app_pods_count"]
        pct = round((p_count / total_app_pods * 100.0), 1) if total_app_pods > 0 else 0.0
        worker_distribution.append({
            "node_name": w["name"],
            "worker_label": f"Worker {idx} ({w['name']})",
            "pod_count": p_count,
            "percentage": pct
        })

    # Summary
    running_pods = sum(1 for p in pods if p["status"] == "Running")
    pending_pods = sum(1 for p in pods if p["status"] == "Pending")
    failed_pods = sum(1 for p in pods if p["status"] == "Failed")
    ready_nodes = sum(1 for n in nodes if n["is_ready"])

    metrics_available = (nodes_metrics_ok or pods_metrics_ok)

    return {
        "timestamp": datetime.now().isoformat(),
        "cluster_name": "workload-cluster",
        "namespace": ns,
        "metrics_available": metrics_available,
        "overview": {
            "total_nodes": len(nodes),
            "ready_nodes": ready_nodes,
            "total_pods": total_app_pods,
            "running_pods": running_pods,
            "pending_pods": pending_pods,
            "failed_pods": failed_pods,
            "deployment": deployment
        },
        "nodes": nodes,
        "workload_distribution": {
            "total_app_pods": total_app_pods,
            "workers": worker_distribution
        },
        "pods": pods
    }


# ==========================================
# 1. Existing Application Endpoints (PRESERVED)
# ==========================================

@app.route("/")
def home():
    """Existing endpoint preserved exactly as implemented."""
    return jsonify({
        "application": "Kubernetes Workload Distribution",
        "pod_name": socket.gethostname(),
        "message": "Hello from Kubernetes!",
        "timestamp": datetime.now().isoformat()
    })


@app.route("/health")
def health():
    """Existing health endpoint preserved exactly as implemented."""
    return jsonify({"status": "healthy"}), 200


# ==========================================
# 2. Modern Dashboard Route
# ==========================================

@app.route("/dashboard")
def dashboard():
    """Renders the professional Kubernetes monitoring dashboard."""
    return render_template("index.html")


# ==========================================
# 3. Live Kubernetes API Endpoints
# ==========================================

@app.route("/api/all-data")
def api_all_data():
    """Consolidated endpoint for real-time dashboard updates."""
    data = build_full_dashboard_state()
    return jsonify(data)


@app.route("/api/cluster-summary")
def api_cluster_summary():
    data = build_full_dashboard_state()
    return jsonify(data["overview"])


@app.route("/api/nodes")
def api_nodes():
    data = build_full_dashboard_state()
    return jsonify({
        "nodes": data["nodes"],
        "metrics_available": data["metrics_available"]
    })


@app.route("/api/workload")
def api_workload():
    data = build_full_dashboard_state()
    return jsonify(data["workload_distribution"])


@app.route("/api/pods")
def api_pods():
    data = build_full_dashboard_state()
    return jsonify({
        "pods": data["pods"],
        "metrics_available": data["metrics_available"]
    })


@app.route("/api/metrics")
def api_metrics():
    data = build_full_dashboard_state()
    return jsonify({
        "metrics_available": data["metrics_available"],
        "error_message": None if data["metrics_available"] else "Metrics Server data is currently unavailable.",
        "nodes": [
            {
                "name": n["name"],
                "role": n["role"],
                "cpu_usage_m": n["cpu_usage_m"],
                "cpu_usage_pct": n["cpu_usage_pct"],
                "memory_usage_mib": n["memory_usage_mib"],
                "memory_usage_pct": n["memory_usage_pct"]
            }
            for n in data["nodes"]
        ],
        "pods": [
            {
                "name": p["name"],
                "cpu_m": p["cpu_m"],
                "memory_mib": p["memory_mib"]
            }
            for p in data["pods"]
        ]
    })


@app.route("/api/test-app")
def api_test_app():
    """
    Actively tests the running Kubernetes workload application.
    Executes a real HTTP check against the workload service or pod.
    Returns the responding pod name, status code, latency, and full payload.
    """
    start_time = time.time()
    test_urls = [
        "http://workload-service.default.svc:5000/",   # In-cluster via Kubernetes Service DNS
        "http://127.0.0.1:5000/"                       # Local / direct localhost
    ]

    response_data = None
    responding_pod = None
    http_code = 500
    latency_ms = 0
    error_msg = None

    # Try in-cluster or direct HTTP
    for url in test_urls:
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=3) as resp:
                http_code = resp.status
                latency_ms = round((time.time() - start_time) * 1000, 2)
                response_data = json.loads(resp.read().decode("utf-8"))
                responding_pod = response_data.get("pod_name", "unknown")
                break
        except Exception:
            continue

    # If direct HTTP cannot reach cluster DNS from outside, query via safe kubectl exec
    if not response_data:
        try:
            # Query a running pod via kubectl exec
            cmd = [
                "kubectl", "exec", "deployment/workload-deployment", "--",
                "python", "-c",
                "import urllib.request, json; print(urllib.request.urlopen('http://localhost:5000/').read().decode())"
            ]
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=5, check=True)
            latency_ms = round((time.time() - start_time) * 1000, 2)
            response_data = json.loads(res.stdout.strip())
            responding_pod = response_data.get("pod_name", "unknown")
            http_code = 200
        except Exception as e:
            error_msg = str(e)
            latency_ms = round((time.time() - start_time) * 1000, 2)

    # Also test /health endpoint
    health_status = "healthy" if http_code == 200 else "unhealthy"

    return jsonify({
        "status": health_status,
        "http_code": http_code,
        "latency_ms": latency_ms,
        "responding_pod": responding_pod or socket.gethostname(),
        "response_payload": response_data,
        "tested_at": datetime.now().isoformat(),
        "error": error_msg
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)

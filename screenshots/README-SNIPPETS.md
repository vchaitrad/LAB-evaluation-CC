# Kubernetes Workload Distribution Monitor — Screenshots

These cropped screenshots are ready to place in the GitHub repository.

## Suggested README image embeds

Use these paths after extracting this folder into your repository root:

```markdown
## Dashboard

![Cluster overview](screenshots/01-cluster-overview-6-replicas.png)
![Node monitoring](screenshots/02-node-monitoring.png)
![Workload distribution](screenshots/03-workload-distribution-6-replicas.png)
![Pod management](screenshots/04-pod-management-6-replicas.png)
![Resource monitoring](screenshots/05-resource-monitoring.png)
![Application health and load test](screenshots/06-application-health-load-test.png)
![Final dashboard after scaling to 8 replicas](screenshots/07-final-dashboard-8-replicas.png)

## Experiment evidence

![Initial cluster and resource baseline](screenshots/08-initial-cluster-and-resource-baseline.png)
![Worker failure and Pod rescheduling](screenshots/09-worker-failure-and-pod-rescheduling.png)
![Scaling from 6 to 8 replicas](screenshots/10-scale-deployment-from-6-to-8.png)
![Eight Pods and resource metrics](screenshots/11-eight-pods-and-resource-metrics.png)
```

## Screenshot notes

- Dashboard screenshots have been cropped to remove browser tabs and address bars.
- Terminal screenshots retain the command output needed as experiment evidence.
- The initial dashboard/workload screenshots show the six-replica 3–3 distribution.
- The final dashboard screenshot shows the eight-replica state, with six Pods on Worker 1 and two on Worker 2.

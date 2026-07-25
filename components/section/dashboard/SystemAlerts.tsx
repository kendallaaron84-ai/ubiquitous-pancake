"use client";

import React, { useEffect, useState } from "react";
import {
  BarChart3,
  Gauge,
  HardDrive,
  Radio,
  ShieldAlert,
  Timer,
  UserPlus,
  Users,
} from "lucide-react";

type AlertSeverity = "high" | "critical";
type MetricTimeframe = "week" | "month" | "quarter" | "year";

interface InfrastructureAlert {
  id: string;
  type: "latency" | "storage" | "security";
  title: string;
  description: string;
  severity: AlertSeverity;
}

const INFRASTRUCTURE_ALERTS: readonly InfrastructureAlert[] = [
  {
    id: "inf-1",
    type: "latency",
    title: "High Website Latency",
    description: "WordPress admin endpoint is responding slowly (2.8s).",
    severity: "critical",
  },
  {
    id: "inf-2",
    type: "storage",
    title: "Storage Limit Approaching",
    description: "Audiobook media vault is using 87% of available storage.",
    severity: "high",
  },
  {
    id: "inf-3",
    type: "security",
    title: "Unusual Login Attempt Blocked",
    description: "Threat protection blocked four consecutive failed requests.",
    severity: "critical",
  },
] as const;

export function ReadershipTelemetry() {
  const [telemetryTimeframe, setTelemetryTimeframe] = useState<MetricTimeframe>("month");
  const [liveUserCount, setLiveUserCount] = useState(14);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setLiveUserCount((previous) => Math.max(8, previous + (Math.random() > 0.5 ? 1 : -1)));
    }, 4000);
    return () => window.clearInterval(interval);
  }, []);

  const scalar = telemetryTimeframe === "week" ? 0.25 : telemetryTimeframe === "quarter" ? 3 : telemetryTimeframe === "year" ? 12 : 1;
  const data = {
    totalTime: Math.round(4120 * scalar),
    newUsers: Math.round(380 * scalar),
    avgActive: Math.round(18 + (telemetryTimeframe === "year" ? 6 : 0)),
  };

  return (
    <section className="space-y-4 rounded-xl border border-border border-t-foreground/10 bg-card p-4 text-card-foreground shadow-md sm:p-5">
      <div className="flex flex-col items-start justify-between gap-3 border-b border-border/60 pb-3">
        <div className="space-y-0.5">
          <h3 className="flex items-center gap-2 text-base font-bold tracking-tight">
            <Radio className="h-4 w-4 animate-pulse text-emerald-500" /> Readership Telemetry
          </h3>
          <p className="text-[11px] text-muted-foreground">Live reading and listening activity.</p>
        </div>
        <div className="grid w-full grid-cols-4 rounded-lg border border-border bg-muted/50 p-1 text-[9px] font-bold">
          {(["week", "month", "quarter", "year"] as MetricTimeframe[]).map((timeframe) => (
            <button
              key={timeframe}
              type="button"
              onClick={() => setTelemetryTimeframe(timeframe)}
              className={telemetryTimeframe === timeframe
                ? "rounded-md bg-background px-1.5 py-1 text-foreground shadow-sm"
                : "rounded-md px-1.5 py-1 capitalize text-muted-foreground hover:text-foreground"}
            >
              {timeframe === "year" ? "Annually" : timeframe}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-emerald-500/30 bg-background p-2 text-emerald-500">
            <Users className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[10px] font-semibold text-muted-foreground">CONCURRENT ACTIVE USERS</div>
            <div className="font-mono text-xl font-bold tracking-tight text-foreground">{liveUserCount} <span className="text-xs text-emerald-500">ONLINE</span></div>
          </div>
        </div>
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="space-y-1 rounded-lg border border-border/60 bg-muted/40 p-2.5">
          <Timer className="mx-auto h-3.5 w-3.5 text-blue-500" />
          <div className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground">Total Time</div>
          <div className="font-mono font-bold text-foreground">{data.totalTime.toLocaleString()}h</div>
        </div>
        <div className="space-y-1 rounded-lg border border-border/60 bg-muted/40 p-2.5">
          <UserPlus className="mx-auto h-3.5 w-3.5 text-purple-500" />
          <div className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground">New Users</div>
          <div className="font-mono font-bold text-foreground">+{data.newUsers}</div>
        </div>
        <div className="space-y-1 rounded-lg border border-border/60 bg-muted/40 p-2.5">
          <BarChart3 className="mx-auto h-3.5 w-3.5 text-orange-500" />
          <div className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground">Avg Active</div>
          <div className="font-mono font-bold text-foreground">~{data.avgActive}/day</div>
        </div>
      </div>
    </section>
  );
}

export function InfrastructureStatusAlerts() {
  const severityStyle = (severity: AlertSeverity) => severity === "critical"
    ? "border-red-500/20 bg-red-500/10 text-red-500"
    : "border-orange-500/20 bg-orange-500/10 text-orange-500";

  return (
    <section className="space-y-3 rounded-xl border border-border border-t-foreground/10 bg-card p-4 text-card-foreground shadow-md sm:p-5">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Infrastructure Status Alerts</h3>
        <p className="mt-1 text-[10px] text-muted-foreground">Items that may need your attention.</p>
      </div>
      <div className="space-y-2">
        {INFRASTRUCTURE_ALERTS.map((alert) => (
          <div key={alert.id} className="flex items-start gap-3 rounded-lg border border-border/50 bg-muted/20 p-2.5 text-left">
            <div className="mt-0.5 shrink-0 rounded border border-border bg-background p-1.5 shadow-sm">
              {alert.type === "latency" ? <Gauge className="h-3.5 w-3.5 text-red-500" />
                : alert.type === "storage" ? <HardDrive className="h-3.5 w-3.5 text-orange-500" />
                : <ShieldAlert className="h-3.5 w-3.5 text-red-500" />}
            </div>
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex items-start justify-between gap-2">
                <span className="text-[11px] font-bold leading-tight text-foreground">{alert.title}</span>
                <span className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase ${severityStyle(alert.severity)}`}>
                  {alert.severity}
                </span>
              </div>
              <p className="text-[10px] leading-snug text-muted-foreground">{alert.description}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function SystemAlerts() {
  return (
    <div className="space-y-6">
      <ReadershipTelemetry />
      <InfrastructureStatusAlerts />
    </div>
  );
}

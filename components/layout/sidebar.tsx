"use client"

import { cn } from "@/core/utils"
import {
    Cpu,           // For KOBA-I Nexus Engine
    Radio,         // For Studio Bridge
    ShieldCheck,   // For Voice Vault
    Layers,        // For Deployments
    LayoutDashboard,
    Settings,
    CreditCard,
    BarChart3,
    MessageSquare, // For Conversations
    X,         
    Package,
	Sliders,
	Database,
	Activity,
    Terminal,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import PerfectScrollbar from "react-perfect-scrollbar"
import { Logo } from "../elements/logo"

// Define types for navigation items
interface NavItem {
  title: string
  icon: React.ComponentType<{ className?: string }>
  href: string
  badge: string | null
}

interface NavSection {
  title?: string
  items: NavItem[]
}

// Fixed Navigation configuration - perfectly bracket-matched
// 1. Update the menu config array with the requested name change and restore Conversations
const navigationSections: NavSection[] = [
    {
        items: [
            { title: "Dashboard", icon: LayoutDashboard, href: "/", badge: null },
            { title: "Product Catalog", icon: Package, href: "/products", badge: "New" },
            { title: "KOBA-I Blog Engine", icon: Cpu, href: "/nexus-engine", badge: "Live" },
            { title: "Studio", icon: Radio, href: "/studio", badge: null },
            { title: "Voice Vault", icon: ShieldCheck, href: "/vault", badge: "Secure" },
            { title: "Conversations", icon: MessageSquare, href: "/conversations", badge: "3" },
            { title: "Automation Center", icon: Terminal, href: "/automation-center", badge: "Core" },
        ],
    },
    {
        title: "Management",
        items: [
            { title: "Deployments", icon: Layers, href: "/deployments", badge: null },
            { title: "Billing & Licenses", icon: CreditCard, href: "/billing", badge: null },
            { title: "Settings", icon: Settings, href: "/settings", badge: null },
            { title: "Documentation", icon: BarChart3, href: "/documentation", badge: null },
        ],
    },
    {
        title: "AI Tools Platform",
        items: [
            { title: "Agent Tuning Panel", icon: Cpu, href: "/agent-builder", badge: "v2" }, // Fix: Matched to actual root folder path
            { title: "Vector Vaults", icon: Database, href: "/vector-database", badge: null }, // Fix: Matched to actual root folder path
            { title: "Model Benchmarks", icon: Activity, href: "/evaluation", badge: null }, // Fix: Matched to actual root folder path
        ],
    },
]

// Navigation component
interface MainNavProps {
  onItemClick: () => void
}

function MainNav({ onItemClick }: MainNavProps) {
    const pathname = usePathname()

    return (
        <div className="relative h-[calc(100vh-5rem)] overflow-hidden">
            {/* EVERYTHING is now safely inside the scrollbar */}
            <PerfectScrollbar className="flex flex-col gap-1 w-full px-3 py-2">
                {navigationSections.map((section, sectionIndex) => (
                    <div key={sectionIndex} className="w-full mb-6 last:mb-0">
                        {section.title && (
                            <div className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                <span>{section.title}</span>
                            </div>
                        )}
                        <div className="space-y-1">
                            {section.items.map((item) => {
                                const isActive = pathname === item.href
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        onClick={onItemClick}
                                        className={cn(
                                            "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium w-full justify-start",
                                            isActive ? "bg-primary text-white" : "text-gray-300 hover:bg-accent transition-colors"
                                        )}
                                    >
                                        <item.icon
                                            className={cn(
                                                "shrink-0 h-5 w-5",
                                                isActive ? "text-white" : "text-muted-foreground"
                                            )}
                                        />
                                        <span className="truncate">{item.title}</span>
                                        {item.badge && (
                                            <span
                                                className={cn(
                                                    "ml-auto px-2 py-0.5 text-xs font-medium rounded-full",
                                                    item.badge === "New"
                                                        ? "bg-green-500/20 text-green-400 border border-green-500/30"
                                                        : item.badge === "Beta"
                                                            ? "bg-orange-500/20 text-orange-400 border border-orange-500/30"
                                                            : "bg-primary text-gray-300"
                                                )}
                                            >
                                                {item.badge}
                                            </span>
                                        )}
                                    </Link>
                                )
                            })}
                        </div>
                    </div>
                ))}
            </PerfectScrollbar>
        </div>
    )
}

// Promo Card component (Unchanged, looks great)
function PromoCard() {
    return (
        <div className="p-2">
            <div className="bg-gradient-to-r from-primary/10 to-gray-600/10 rounded-xl p-4 m-2 border border-primary">
                <h3 className="text-sm font-semibold text-white">Upgrade to Pro</h3>
                <p className="text-xs text-gray-300 mt-1">Unlock premium features and boost productivity!</p>
                <Link
                    href="/pricing"
                    prefetch={false} // 🔑 Fixes the background 404 console error instantly
                    className="inline-block mt-3 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg"
                >
                    Learn More
                </Link>
            </div>
        </div>
    )
}

// Unified Sidebar component
interface DashboardSidebarProps {
  mobileOpen: boolean
  setMobileOpen: (open: boolean) => void
}
// ------------------------------------------------------------------
// ONLY ONE DashboardSidebar function should exist in this file
// ------------------------------------------------------------------
export function DashboardSidebar({ mobileOpen, setMobileOpen }: DashboardSidebarProps) {
	return (
		<div
			className={cn(
				"flex flex-col bg-background fixed top-0 left-0 bottom-0 z-[60] w-[280px] border-r transition-transform duration-300 ease-out",
				!mobileOpen && "lg:translate-x-0 -translate-x-full"
			)}
		>
			{/* Header */}
			<div className="flex border-b h-[88px] py-4 px-8 items-center">
				<Link href="/" className="flex items-center gap-3">
					<Logo size="md" />
				</Link>
				<button
				title="Close sidebar"
					onClick={() => setMobileOpen(false)}
					className="ml-auto p-2 rounded-lg bg-muted md:hidden"
				>
					<X className="h-5 w-5 text-muted-foreground" />
				</button>
			</div>

			{/* Navigation */}
			<div className="flex-1 p-2 overflow-y-auto">
				<MainNav onItemClick={() => setMobileOpen(false)} />
			</div>

			{/* Promo Card */}
			{!mobileOpen && <PromoCard />}
		</div>
	)
}
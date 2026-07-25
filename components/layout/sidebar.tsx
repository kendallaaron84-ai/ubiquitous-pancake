"use client"

import { cn } from "@/core/utils"
import { auth, db } from "@/core/firebase"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { doc, onSnapshot } from "firebase/firestore"
import { onAuthStateChanged } from "firebase/auth"
import {
    Cpu,           // For KOBA-I Nexus Engine
    Radio,         // For Studio Bridge
    ShieldCheck,   // For Voice Vault
    Layers,        // For Deployments
    LayoutDashboard,
    Settings,
    BarChart3,
    MessageSquare, // For Conversations
    X,         
    Package,
	Sliders,
	Database,
	Activity,
    Terminal,
    Loader2,
    Link2,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
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

type ConnectionStatus = "loading" | "connected" | "not_connected"

interface SidebarAccessState {
  isOwner: boolean
  connectionStatus: ConnectionStatus
}

const STANDARD_NAVIGATION: NavSection[] = [
    {
        items: [
            { title: "Dashboard", icon: LayoutDashboard, href: "/", badge: null },
            { title: "Product Catalog", icon: Package, href: "/products", badge: "New" },
            { title: "KOBA-I Blog Engine", icon: Cpu, href: "/nexus-engine", badge: "Live" },
        ],
    },
]

const OWNER_ONLY_PRIMARY_NAVIGATION: NavItem[] = [
            { title: "Studio", icon: Radio, href: "/studio", badge: null },
            { title: "Voice Vault", icon: ShieldCheck, href: "/vault", badge: "Secure" },
            { title: "Conversations", icon: MessageSquare, href: "/conversations", badge: "3" },
            { title: "Automation Center", icon: Terminal, href: "/automation-center", badge: "Core" },
]

function buildNavigationSections(access: SidebarAccessState): NavSection[] {
    const primaryItems = access.isOwner
        ? [...STANDARD_NAVIGATION[0].items, ...OWNER_ONLY_PRIMARY_NAVIGATION]
        : STANDARD_NAVIGATION[0].items
    const connectionBadge =
        access.connectionStatus === "loading"
            ? null
            : access.connectionStatus === "connected"
                ? "Connected"
                : "Setup Site"

    const managementItems: NavItem[] = [
        ...(access.isOwner
            ? [{ title: "Deployments", icon: Layers, href: "/deployments", badge: null }]
            : []),
        {
            title: "Setup & Connections",
            icon: Sliders,
            href: "/connect",
            badge: connectionBadge,
        },
        ...(access.isOwner
            ? [
                { title: "Author Connections", icon: Link2, href: "/admin/connections", badge: "Owner" },
                { title: "Settings", icon: Settings, href: "/settings", badge: null },
                { title: "Documentation", icon: BarChart3, href: "/documentation", badge: null },
            ]
            : []),
    ]

    const sections: NavSection[] = [
        { items: primaryItems },
        { title: "Management", items: managementItems },
    ]

    if (access.isOwner) {
        sections.push({
            title: "AI Tools Platform",
            items: [
                { title: "Agent Tuning Panel", icon: Cpu, href: "/agent-builder", badge: "v2" },
                { title: "Vector Vaults", icon: Database, href: "/vector-database", badge: null },
                { title: "Model Benchmarks", icon: Activity, href: "/evaluation", badge: null },
            ],
        })
    }

    return sections
}

// Navigation component
interface MainNavProps {
  onItemClick: () => void
}

function MainNav({ onItemClick }: MainNavProps) {
    const pathname = usePathname()
    const [access, setAccess] = useState<SidebarAccessState>({
        isOwner: false,
        connectionStatus: "loading",
    })

    useEffect(() => {
        const controller = new AbortController()

        fetch("/api/session", {
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
        })
            .then(async (response) => {
                if (!response.ok) throw new Error("Session status unavailable.")
                return response.json() as Promise<{
                    isOwner?: boolean
                    connectionStatus?: "connected" | "not_connected"
                }>
            })
            .then((payload) => {
                setAccess({
                    isOwner: payload.isOwner === true,
                    connectionStatus:
                        payload.connectionStatus === "connected"
                            ? "connected"
                            : "not_connected",
                })
            })
            .catch((error: unknown) => {
                if (error instanceof DOMException && error.name === "AbortError") return
                setAccess({ isOwner: false, connectionStatus: "not_connected" })
            })

        return () => controller.abort()
    }, [])

    const navigationSections = buildNavigationSections(access)

    return (
        <div className="relative h-[calc(100vh-5rem)] overflow-hidden">
            {/* EVERYTHING is now safely inside the scrollbar */}
            <PerfectScrollbar className="flex flex-col gap-1 w-full px-3 py-2">
                {navigationSections.map((section, sectionIndex) => (
                    <div key={sectionIndex} className="w-full mb-6 last:mb-0">
                        {section.title && (
                            <div className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-zinc-600 dark:text-gray-400 uppercase tracking-wider">
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
                                            isActive
                                                ? "bg-primary text-white"
                                                : "text-zinc-700 hover:bg-accent hover:text-zinc-900 dark:text-gray-300 dark:hover:text-white transition-colors"
                                        )}
                                    >
                                        <item.icon
                                            className={cn(
                                                "shrink-0 h-5 w-5",
                                                isActive ? "text-white" : "text-zinc-500 dark:text-muted-foreground"
                                            )}
                                        />
                                        <span className="truncate">{item.title}</span>
                                        {item.badge && (
                                            <span
                                                className={cn(
                                                    "ml-auto px-2 py-0.5 text-xs font-medium rounded-full",
                                                    item.badge === "New" || item.badge === "Connected"
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

type PlanTier = "free" | "starter" | "pro"

interface AuthenticatedAuthor {
    email: string
    plan: PlanTier
}

function normalizePlan(value: unknown): PlanTier {
    return value === "starter" || value === "pro" ? value : "free"
}

function UpgradeCard() {
    const [user, setUser] = useState<AuthenticatedAuthor | null>(null)
    const [isResolvingProfile, setIsResolvingProfile] = useState(true)
    const [checkoutPlan, setCheckoutPlan] = useState<Exclude<PlanTier, "free"> | null>(null)
    const [checkoutError, setCheckoutError] = useState("")

    useEffect(() => {
        let unsubscribeProfile: (() => void) | null = null

        const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
            unsubscribeProfile?.()
            unsubscribeProfile = null

            if (!firebaseUser?.email) {
                setUser(null)
                setIsResolvingProfile(false)
                return
            }

            const email = firebaseUser.email.trim().toLowerCase()
            unsubscribeProfile = onSnapshot(
                doc(db, "users", email),
                (profileSnapshot) => {
                    setUser({
                        email,
                        plan: normalizePlan(profileSnapshot.data()?.plan),
                    })
                    setIsResolvingProfile(false)
                },
                (error) => {
                    console.error("Unable to resolve the author subscription tier.", error)
                    setUser(null)
                    setIsResolvingProfile(false)
                }
            )
        })

        return () => {
            unsubscribeProfile?.()
            unsubscribeAuth()
        }
    }, [])

    async function beginCheckout(plan: Exclude<PlanTier, "free">) {
        if (!user?.email || checkoutPlan) return

        setCheckoutPlan(plan)
        setCheckoutError("")

        try {
            const response = await fetch("/api/checkout/create-session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ authorEmail: user.email, plan }),
            })
            const payload = (await response.json().catch(() => null)) as
                | { checkoutUrl?: string; error?: string }
                | null

            if (!response.ok || !payload?.checkoutUrl) {
                throw new Error(payload?.error || "Unable to open secure checkout.")
            }

            window.location.assign(payload.checkoutUrl)
        } catch (error) {
            setCheckoutError(
                error instanceof Error
                    ? error.message
                    : "Unable to open secure checkout. Please try again."
            )
            setCheckoutPlan(null)
        }
    }

    if (isResolvingProfile || !user || user.plan === "starter" || user.plan === "pro") {
        return null
    }

    return (
        <div className="p-2">
            <div className="m-2 rounded-xl border border-[#f5b942] bg-[#733026] p-4 text-white shadow-lg dark:bg-[#1a2238]">
                <h3 className="text-sm font-bold">👑 Increase Your Voice’s Reach</h3>
                <p className="mt-2 text-xs leading-relaxed text-white/90">
                    Is your audience not finding you? Use the exact same AI promotion tools the industry giants use to let your fans know you&apos;re here with a great story.
                </p>

                <Dialog onOpenChange={(open) => !open && setCheckoutError("")}>
                    <DialogTrigger asChild>
                        <button
                            type="button"
                            className="mt-4 w-full rounded-lg bg-[#f97316] py-2 text-xs font-bold text-white shadow-md transition-colors hover:bg-[#e06613] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#733026]"
                        >
                            Explore the Tools
                        </button>
                    </DialogTrigger>

                    <DialogContent className="max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-6xl overflow-y-auto border-border bg-background p-4 shadow-2xl sm:max-w-6xl sm:p-6 lg:p-8">
                        <DialogHeader className="mx-auto max-w-4xl text-center sm:text-center">
                            <DialogTitle className="pr-8 text-2xl leading-tight text-foreground sm:pr-0 sm:text-3xl">
                                The Independent Author&apos;s Visibility Cure
                            </DialogTitle>
                            <DialogDescription className="text-sm leading-relaxed text-muted-foreground sm:text-base">
                                The big publishing giants use massive technical systems to dominate the market. Now, you have access to the exact same power. Stop competing using manual methods. We help you skip the gatekeepers. Enjoy hands-free visibility automation, secure voice identity protection, and amazing cinematic avatar tools. These features bring your stories straight to your enthusiastic fans.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="mt-3 grid grid-cols-1 items-stretch gap-6 md:grid-cols-3">
                            <section className="flex min-h-[270px] flex-col rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-md">
                                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Free Tier</p>
                                <h3 className="mt-2 text-lg font-black tracking-tight leading-snug">Foundation Catalog</h3>
                                <p className="mt-4 text-3xl font-black tracking-tight">$0 <span className="text-sm font-semibold tracking-normal text-muted-foreground">/ mo</span></p>
                                <div className="mt-auto pt-8">
                                    <button type="button" disabled className="w-full cursor-not-allowed rounded-lg border border-border bg-muted px-4 py-3 text-sm font-bold text-muted-foreground">
                                        Current Active Tier
                                    </button>
                                </div>
                            </section>

                            <section className="flex min-h-[290px] flex-col rounded-2xl border-2 border-[#f97316] bg-primary p-5 text-primary-foreground shadow-xl md:-translate-y-2">
                                <p className="text-xs font-bold uppercase tracking-wider text-white/80">Starter Tier</p>
                                <h3 className="mt-2 text-lg font-black tracking-tight leading-snug text-white">Traffic Generator &amp; Asset Vault</h3>
                                <p className="mt-4 text-3xl font-black tracking-tight text-white">$30 <span className="text-sm font-semibold tracking-normal text-white/75">/ mo</span></p>
                                <div className="mt-auto pt-8">
                                    <button type="button" disabled={checkoutPlan !== null} onClick={() => beginCheckout("starter")} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#f97316] px-4 py-3 text-sm font-bold text-white shadow-md transition-colors hover:bg-[#e06613] disabled:cursor-wait disabled:opacity-70">
                                        {checkoutPlan === "starter" && <Loader2 className="h-4 w-4 animate-spin" />}
                                        Choose Starter
                                    </button>
                                </div>
                            </section>

                            <section className="flex min-h-[270px] flex-col rounded-2xl border border-[#8b4528] bg-card p-5 text-card-foreground shadow-md">
                                <p className="text-xs font-bold uppercase tracking-wider text-[#8b4528] dark:text-[#f0a37f]">Pro Tier</p>
                                <h3 className="mt-2 text-lg font-black tracking-tight leading-snug">Cinematic Multi-Channel Engine</h3>
                                <p className="mt-4 text-3xl font-black tracking-tight">$60 <span className="text-sm font-semibold tracking-normal text-muted-foreground">/ mo</span></p>
                                <div className="mt-auto pt-8">
                                    <button type="button" disabled={checkoutPlan !== null} onClick={() => beginCheckout("pro")} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#8b4528] px-4 py-3 text-sm font-bold text-white shadow-md transition-colors hover:bg-[#733026] disabled:cursor-wait disabled:opacity-70">
                                        {checkoutPlan === "pro" && <Loader2 className="h-4 w-4 animate-spin" />}
                                        Choose Pro
                                    </button>
                                </div>
                            </section>
                        </div>

                        <p aria-live="polite" className="min-h-5 text-center text-sm font-semibold text-destructive">
                            {checkoutError}
                        </p>
                    </DialogContent>
                </Dialog>
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

			{/* Subscription-aware promotion */}
			<UpgradeCard />
		</div>
	)
}

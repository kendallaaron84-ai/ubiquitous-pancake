"use client"

import React, { useEffect, useState } from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LogOut, Settings, User, Wallet } from "lucide-react"
import Link from "next/link"

// 🔑 Import the Router and Auth modules
import { useRouter } from "next/navigation"
import { signOut, getAuth, onAuthStateChanged } from "firebase/auth"
import { auth } from "@/core/firebase"

export function UserNav() {
	const router = useRouter();
	const [userEmail, setUserEmail] = useState<string | null>("Loading...");

	// Dynamically fetch the logged-in user's email to replace the hardcoded placeholder
	useEffect(() => {
		const firebaseAuth = getAuth();
		const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
			if (user && user.email) {
				setUserEmail(user.email);
			} else {
				setUserEmail("Not Signed In");
			}
		});
		return () => unsubscribe();
	}, []);

	// 🛑 THE MASTER LOGOUT FUNCTION
	const handleLogout = async () => {
		try {
			// 1. Kill the Firebase auth state
			await signOut(auth);

			// 2. Erase the secure session cookie by setting its expiration to the past
			document.cookie = "__session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; SameSite=Strict";

			// 3. Force a hard redirect back to the login screen
			router.push("/signin");
			router.refresh();
		} catch (error) {
			console.error("Logout failed:", error);
		}
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" className="h-9 w-9 rounded-full hover:bg-transparent">
					<Avatar className="h-8 w-8">
						<AvatarFallback className="bg-primary text-primary-foreground font-bold">K</AvatarFallback>
					</Avatar>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="w-56 border-border bg-card text-card-foreground" align="end">
				<div className="flex items-center gap-3 p-3">
					<Avatar className="h-9 w-9">
						<AvatarFallback className="bg-primary text-primary-foreground font-bold">K</AvatarFallback>
					</Avatar>
					<div className="flex flex-col">
						<p className="text-sm font-medium">Operator Account</p>
						<p className="text-xs text-muted-foreground truncate max-w-[150px]">{userEmail}</p>
					</div>
				</div>
				<DropdownMenuSeparator className="bg-border" />
				<Link href="/profile" className="w-full">
					<DropdownMenuItem className="flex items-center gap-3 p-3 cursor-pointer focus:bg-muted">
						<User className="h-4 w-4" />
						<span>Profile</span>
					</DropdownMenuItem>
				</Link>
				<Link href="/wallets" className="w-full">
					<DropdownMenuItem className="flex items-center gap-3 p-3 cursor-pointer focus:bg-muted">
						<Wallet className="h-4 w-4" />
						<span>Wallets</span>
					</DropdownMenuItem>
				</Link>
				<Link href="/settings" className="w-full">
					<DropdownMenuItem className="flex items-center gap-3 p-3 cursor-pointer focus:bg-muted">
						<Settings className="h-4 w-4" />
						<span>Settings</span>
					</DropdownMenuItem>
				</Link>
				<DropdownMenuSeparator className="bg-border" />
				
				{/* 🔑 REPLACED THE LINK WITH THE ONCLICK LOGOUT HANDLER */}
				<DropdownMenuItem 
					onClick={handleLogout} 
					className="flex items-center gap-3 p-3 text-red-500 focus:text-red-500 focus:bg-red-500/10 cursor-pointer transition-colors"
				>
					<LogOut className="h-4 w-4" />
					<span>Logout</span>
				</DropdownMenuItem>

			</DropdownMenuContent>
		</DropdownMenu>
	)
}
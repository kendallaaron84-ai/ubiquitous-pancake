"use client"

import { cn } from "@/core/utils"

interface LogoProps {
	className?: string
	size?: "sm" | "md" | "lg" | "xl"
	vertical?: boolean
	companyName?: string
}

export function Logo({
	className,
	size = "md",
	vertical = false,
	companyName = "KOBA-I Audio",
}: LogoProps) {
	
	const textSize = {
		sm: "text-lg",
		md: "text-xl",
		lg: "text-2xl",
		xl: "text-3xl",
	}[size]

	return (
		<div className={cn("flex flex-col justify-center", className)}>
			{/* High-Contrast White Text Brand Title */}
			<span className={cn("font-bold tracking-tight text-white leading-none", textSize)}>
				{companyName}
			</span>
			
			{/* Slogan Subtext Block */}
			{!vertical && size !== "sm" && (
				<span className="text-[10px] text-gray-400 tracking-widest mt-1.5 font-semibold uppercase leading-none">
					YOUR VOICE. YOUR TERMS.
				</span>
			)}
		</div>
	)
}
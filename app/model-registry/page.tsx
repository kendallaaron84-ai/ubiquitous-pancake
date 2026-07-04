"use client"

import Layout from "@/components/layout"
import ModelRegistry from "@/components/section/model-registry"

export const dynamic = 'force-dynamic';

export default function ModelRegistryPage() {

	return (
		<Layout >
			<ModelRegistry />
		</Layout>
	)
}

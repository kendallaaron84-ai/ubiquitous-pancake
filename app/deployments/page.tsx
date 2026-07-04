import Layout from "@/components/layout"
import Deployments from "@/components/section/deployments"

export const dynamic = 'force-dynamic';

export default function DeploymentsPage() {
	return (
		<Layout >
			<Deployments />
		</Layout>
	)
}

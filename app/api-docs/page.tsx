import Layout from "@/components/layout"
import ApiDocs from "@/components/section/api-docs"

export const dynamic = 'force-dynamic';

export default function ApiDocsPage() {
	return (
		<Layout >
			<ApiDocs />
		</Layout>
	)
}

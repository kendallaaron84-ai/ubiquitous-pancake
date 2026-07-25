import { NextResponse } from "next/server";
import { adminDb } from "@/core/firebase-admin";
import { requireAuthorizedAuthorIdentity } from "@/core/security/author-identity";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(),
  });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const authorParam = searchParams.get("author")?.trim();
    const assetParam = searchParams.get("asset")?.trim();
    const limitParam = searchParams.get("limit") || "50";

    const studioKey = (
      request.headers.get("x-studio-key") ||
      request.headers.get("X-Studio-Key") ||
      ""
    ).trim();

    /*
     * PUBLIC PRODUCT ROUTING
     *
     * Catalog:
     *   ?author=tenant (legacy-compatible display parameter)
     *
     * Single publication:
     *   ?asset=ebk_sample-ebook
     */
    if (authorParam || assetParam) {
      if (!studioKey) {
        return NextResponse.json(
          {
            success: false,
            error: "An activated StudioKey is required.",
          },
          {
            status: 403,
            headers: getCorsHeaders(),
          }
        );
      }

      const activeLicense = await adminDb
        .collection("plugin_licenses")
        .doc(studioKey)
        .get();
      const licenseData = activeLicense.data();

      if (
        !activeLicense.exists ||
        licenseData?.status !== "active"
      ) {
        return NextResponse.json(
          {
            success: false,
            error: "This StudioKey is not active.",
          },
          {
            status: 403,
            headers: getCorsHeaders(),
          }
        );
      }

      const requestedLimit = Math.min(
        Math.max(
          Number.parseInt(limitParam, 10) || 50,
          1
        ),
        100
      );

      let productDocs: FirebaseFirestore.DocumentSnapshot[] =
        [];

      /*
       * Reader mode: retrieve one product.
       */
      if (assetParam) {
        const directSnapshot = await adminDb
          .collection("products")
          .doc(assetParam)
          .get();

        if (directSnapshot.exists) {
          const directData = directSnapshot.data();
          const directTenant = String(
            directData?.studioKey ||
            directData?.wpStudioKey ||
            ""
          ).trim();

          if (directTenant === studioKey) {
            productDocs = [directSnapshot];
          }
        } else {
          const fallbackSnapshot = await adminDb
            .collection("products")
            .where("assetKey", "==", assetParam)
            .where("studioKey", "==", studioKey)
            .limit(1)
            .get();

          productDocs = fallbackSnapshot.docs;
        }
      } else {
        /*
         * Catalog mode: the Firestore query itself is tenant-bound.
         * Browser-supplied author labels are never authorization.
         */
        const productsSnapshot = await adminDb
          .collection("products")
          .where("studioKey", "==", studioKey)
          .limit(requestedLimit)
          .get();

        productDocs = productsSnapshot.docs;
      }

      console.log("[KOBA Catalog] Request", {
        assetParam: assetParam || null,
        mode: assetParam
          ? "single-publication"
          : "catalog",
        documentCount: productDocs.length,
      });

      const catalogItems: Record<string, unknown>[] =
        [];

      for (const documentSnapshot of productDocs) {
        const data = documentSnapshot.data();

        if (!data) {
          continue;
        }

        const isPublished =
          data.status === "published" ||
          data.isPublished === true;
        const wordpressDeploymentStatus = String(
          data.wordpressDeployment?.status || ""
        ).trim();

        if (
          !isPublished ||
          (
            wordpressDeploymentStatus &&
            wordpressDeploymentStatus !== "deployed"
          )
        ) {
          console.log(
            "[KOBA Catalog] Skipping product without a confirmed deployment",
            documentSnapshot.id
          );

          continue;
        }

        const assetKey =
          data.assetKey || documentSnapshot.id;

        const derivedType =
          data.type ||
          data.assetType ||
          (
            assetKey.startsWith("abk_")
              ? "audiobook"
              : assetKey.startsWith("ebk_")
                ? "ebook"
                : "publication"
          );

        const ebookChapters = Array.isArray(
          data.ebookPayload?.chapters
        )
          ? data.ebookPayload.chapters
          : [];

        const topLevelChapters = Array.isArray(
          data.chapters
        )
          ? data.chapters
          : [];

        const studioTracks = Array.isArray(
          data.studioTracks
        )
          ? data.studioTracks
          : [];

        const chapters =
          derivedType === "ebook"
            ? (
                ebookChapters.length > 0
                  ? ebookChapters
                  : topLevelChapters
              )
            : (
                studioTracks.length > 0
                  ? studioTracks
                  : topLevelChapters
              );

        const tenantKey = String(data.studioKey || data.wpStudioKey || "").trim();
        const authorEmail = String(data.authorEmail || data.authorId || "").trim().toLowerCase();
        const authorIdentityId = String(data.authorIdentityId || "").trim();
        if (tenantKey !== studioKey) {
          console.warn("[KOBA Catalog] Blocked cross-tenant product", assetKey);
          continue;
        }
        if (!tenantKey || !authorEmail) {
          console.warn("[KOBA Catalog] Skipping product without an author workspace", assetKey);
          continue;
        }

        let verifiedAuthorName = String(data.authorName || "Sovereign Author").trim();
        if (authorIdentityId) {
          try {
            const authorIdentity = await requireAuthorizedAuthorIdentity(
              adminDb,
              tenantKey,
              authorEmail,
              authorIdentityId
            );
            verifiedAuthorName = authorIdentity.displayName;
          } catch {
            console.warn("[KOBA Catalog] Skipping product with an unauthorized author identity", assetKey);
            continue;
          }
        } else {
          if (activeLicense.exists && activeLicense.data()?.status === "active") {
            console.warn("[KOBA Catalog] Skipping licensed product without a registered author identity", assetKey);
            continue;
          }
          console.warn("[KOBA Catalog] Serving legacy product pending identity migration", assetKey);
        }

        const catalogProduct = {
          assetKey,
          type: derivedType,
          title: data.title || "Untitled",
          description:
            data.description ||
            data.synopsis ||
            "",
          coverUrl:
            data.coverArtUrl ||
            data.coverUrl ||
            "/placeholder.jpg",
          bgImageUrl:
            data.bgImageUrl ||
            data.backgroundUrl ||
            "",
          authorName: verifiedAuthorName,
          authorIdentityId: authorIdentityId || null,
          authorEmail: data.authorEmail || "",
          authorId: data.authorId || "",
          price: Number(data.price ?? data.unitPrice ?? 0),
          category:
            String(data.category || "").trim() ||
            (derivedType === "ebook" ? "E-Books" : "Audiobooks"),
        };

        /*
         * Single-publication mode is metadata-only. Protected chapters,
         * manuscripts, and audio sources are served by /api/media/manifest
         * after entitlement-backed reader-token verification.
         */
        if (assetParam) {
          catalogItems.push({
            ...catalogProduct,
            chapterCount: chapters.length,
          });

          continue;
        }

        /*
         * Catalog mode remains lightweight.
         */
        catalogItems.push({
          ...catalogProduct,
          chapterCount: chapters.length,
        });
      }

      if (
        assetParam &&
        catalogItems.length === 0
      ) {
        return NextResponse.json(
          {
            success: false,
            error: "Publication not found.",
            assetKey: assetParam,
          },
          {
            status: 404,
            headers: getCorsHeaders(),
          }
        );
      }

      const authorName = String(
        licenseData?.authorName ||
        licenseData?.authorEmail ||
        "KOBA-I Author"
      ).trim();

      return NextResponse.json(
        {
          success: true,
          mode: assetParam
            ? "single-publication"
            : "catalog",
          authorName,
          products: catalogItems,
          books: catalogItems,
          content: [],
        },
        {
          status: 200,
          headers: getCorsHeaders(),
        }
      );
    }

    /*
     * Existing fallback content pipeline.
     */
    if (studioKey) {
      const publicContent: Record<
        string,
        unknown
      >[] = [];

      const contentSnapshot = await adminDb
        .collection("audiobook_requests")
        .where("studioKey", "==", studioKey)
        .where("status", "==", "Completed")
        .limit(
          Number.parseInt(limitParam, 10) || 50
        )
        .get();

      contentSnapshot.forEach((documentSnapshot: FirebaseFirestore.QueryDocumentSnapshot) => {
        const data = documentSnapshot.data();

        publicContent.push({
          id: documentSnapshot.id,
          title:
            data.topicTitle ||
            data.title ||
            "Untitled Post",
          body:
            data.generatedContent ||
            data.body ||
            "",
          excerpt:
            data.synopsis ||
            data.description ||
            "",
          category:
            data.brandAllocation ||
            "General",
          targetAudience:
            data.targetAudience ||
            "",
          publishedAt:
            data.completedAt &&
            typeof data.completedAt.toDate ===
              "function"
              ? data.completedAt
                  .toDate()
                  .toISOString()
              : data.completedAt ||
                new Date().toISOString(),
        });
      });

      return NextResponse.json(
        {
          success: true,
          content: publicContent,
          products: [],
          books: [],
        },
        {
          status: 200,
          headers: getCorsHeaders(),
        }
      );
    }

    return NextResponse.json(
      {
        error:
          "Missing authorized context routing keys.",
      },
      {
        status: 400,
        headers: getCorsHeaders(),
      }
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown server error";

    console.error(
      "❌ Unified Content API Master Hub Error:",
      error
    );

    return NextResponse.json(
      {
        error: "Internal Server Error Data Lock",
        details: message,
      },
      {
        status: 500,
        headers: getCorsHeaders(),
      }
    );
  }
}

function getCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods":
      "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, x-studio-key, X-Studio-Key",
  };
}

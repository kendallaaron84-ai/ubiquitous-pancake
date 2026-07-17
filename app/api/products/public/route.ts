import { NextResponse } from "next/server";
import { adminDb } from "@/core/firebase-admin";

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

    const studioKey =
      request.headers.get("x-studio-key") ||
      request.headers.get("X-Studio-Key");

    /*
     * PUBLIC PRODUCT ROUTING
     *
     * Catalog:
     *   ?author=global
     *
     * Single publication:
     *   ?asset=ebk_sample-ebook
     */
    if (authorParam || assetParam) {
      const targetAuthor = (authorParam || "global").trim();

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
          productDocs = [directSnapshot];
        } else {
          const fallbackSnapshot = await adminDb
            .collection("products")
            .where("assetKey", "==", assetParam)
            .limit(1)
            .get();

          productDocs = fallbackSnapshot.docs;
        }
      } else {
        /*
         * Catalog mode: retrieve the global library
         * or one author's library.
         */
        let queryRef: FirebaseFirestore.Query =
          adminDb.collection("products");

        if (
          targetAuthor.toLowerCase() !== "global"
        ) {
          queryRef = queryRef.where(
            "authorEmail",
            "==",
            targetAuthor
          );
        }

        const productsSnapshot = await queryRef
          .limit(requestedLimit)
          .get();

        productDocs = productsSnapshot.docs;
      }

      console.log("[KOBA Catalog] Request", {
        targetAuthor,
        assetParam: assetParam || null,
        mode: assetParam
          ? "single-publication"
          : "catalog",
        documentCount: productDocs.length,
      });

      const catalogItems: Record<string, unknown>[] =
        [];

      productDocs.forEach((documentSnapshot) => {
        const data = documentSnapshot.data();

        if (!data) {
          return;
        }

        const isPublished =
          data.status === "published" ||
          data.isPublished === true;

        if (!isPublished) {
          console.log(
            "[KOBA Catalog] Skipping unpublished product",
            documentSnapshot.id
          );

          return;
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
          authorName:
            data.authorName ||
            (
              data.authorEmail
                ? data.authorEmail.split("@")[0]
                : "Sovereign Author"
            ),
          authorEmail: data.authorEmail || "",
          authorId: data.authorId || "",
          price: Number(data.price || 0),
        };

        /*
         * Reader mode includes full chapter data.
         */
        if (assetParam) {
          catalogItems.push({
            ...catalogProduct,
            chapters,

            ...(derivedType === "ebook"
              ? {
                  ebookPayload: {
                    ...(data.ebookPayload ?? {}),
                    chapters,
                  },
                }
              : {
                  studioTracks,
                }),
          });

          return;
        }

        /*
         * Catalog mode remains lightweight.
         */
        catalogItems.push({
          ...catalogProduct,
          chapterCount: chapters.length,
        });
      });

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

      const authorName =
        targetAuthor.toLowerCase() === "global"
          ? "KOBA-I Global Library"
          : targetAuthor.split("@")[0];

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
        .where("status", "==", "Completed")
        .limit(
          Number.parseInt(limitParam, 10) || 50
        )
        .get();

      contentSnapshot.forEach((documentSnapshot) => {
        const data = documentSnapshot.data();

        if (data.studioKey !== studioKey) {
          return;
        }

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
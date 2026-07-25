"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import type { DocumentData, QueryDocumentSnapshot } from "firebase/firestore";

import { auth, db } from "@/core/firebase";

export type PlanTier = "free" | "starter" | "pro";

export interface MarketingBudgetValues {
  paidTrafficBudget: number;
  printAndEventsBudget: number;
  annualRevenueGoal: number;
}

export interface MarketingCatalogProduct {
  id: string;
  title: string;
  unitPrice: number;
  status: string;
  isPublished: boolean;
  currentSales: number | null;
}

const PLAN_COSTS: Readonly<Record<PlanTier, number>> = {
  free: 0,
  starter: 30,
  pro: 60,
};

function normalizePlan(value: unknown): PlanTier {
  return value === "starter" || value === "pro" ? value : "free";
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function mapCatalogProduct(productDocument: QueryDocumentSnapshot<DocumentData>): MarketingCatalogProduct {
  const data = productDocument.data();
  const storedPrice = data.price ?? data.unitPrice;
  const rawPrice = typeof storedPrice === "number" ? storedPrice : Number(storedPrice);
  const rawCurrentSales = typeof data.currentSales === "number" ? data.currentSales : Number(data.currentSales);
  const normalizedStatus = optionalString(data.status).toLowerCase();
  const isPublished = data.isPublished === true || normalizedStatus === "published" || normalizedStatus === "active";

  return {
    id: productDocument.id,
    title: optionalString(data.title) || productDocument.id,
    unitPrice: Number.isFinite(rawPrice) && rawPrice >= 0 ? rawPrice : 0,
    status: isPublished ? "Active Publication" : (optionalString(data.status) || "Draft"),
    isPublished,
    currentSales: Number.isFinite(rawCurrentSales) ? rawCurrentSales : null,
  };
}

export function useMarketingBudgetPlanner() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [plan, setPlan] = useState<PlanTier>("free");
  const [isPlanLoading, setIsPlanLoading] = useState(true);
  const [allProducts, setAllProducts] = useState<MarketingCatalogProduct[]>([]);
  const [isBookPriceLoading, setIsBookPriceLoading] = useState(true);
  const [budget, setBudget] = useState<MarketingBudgetValues>({
    paidTrafficBudget: 150,
    printAndEventsBudget: 60,
    annualRevenueGoal: 100000,
  });

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;
    let unsubscribeProducts: (() => void) | null = null;

    const clearCatalogSubscriptions = () => {
      unsubscribeProducts?.();
      unsubscribeProducts = null;
    };

    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      unsubscribeProfile?.();
      unsubscribeProfile = null;
      clearCatalogSubscriptions();

      const authorEmail = firebaseUser?.email?.trim().toLowerCase();
      if (!authorEmail) {
        setPlan("free");
        setIsPlanLoading(false);
        setAllProducts([]);
        setIsBookPriceLoading(false);
        return;
      }

      unsubscribeProfile = onSnapshot(
        doc(db, "users", authorEmail),
        (profileSnapshot) => {
          clearCatalogSubscriptions();

          const profileData = profileSnapshot.data() ?? {};
          const studioKey = optionalString(profileData.studioKey);
          setPlan(normalizePlan(profileData.plan));
          setIsPlanLoading(false);
          setIsBookPriceLoading(true);

          const scopedQueries = [
            query(collection(db, "products"), where("authorEmail", "==", authorEmail)),
            query(collection(db, "products"), where("authorId", "==", authorEmail)),
            ...(studioKey ? [
              query(collection(db, "products"), where("studioKey", "==", studioKey)),
              query(collection(db, "products"), where("wpStudioKey", "==", studioKey)),
            ] : []),
          ];
          const productsByScope = new Map<number, MarketingCatalogProduct[]>();
          const publishMergedProducts = () => {
            const mergedProducts = new Map<string, MarketingCatalogProduct>();
            productsByScope.forEach((products) => {
              products.forEach((product) => mergedProducts.set(product.id, product));
            });
            setAllProducts(
              Array.from(mergedProducts.values()).sort((left, right) => left.title.localeCompare(right.title))
            );
            setIsBookPriceLoading(false);
          };

          const scopedUnsubscribers = scopedQueries.map((scopedQuery, scopeIndex) => onSnapshot(
            scopedQuery,
            (productsSnapshot) => {
              productsByScope.set(scopeIndex, productsSnapshot.docs.map(mapCatalogProduct));
              publishMergedProducts();
            },
            (error) => {
              console.error("Unable to resolve one authenticated product scope.", error);
              productsByScope.set(scopeIndex, []);
              publishMergedProducts();
            }
          ));
          unsubscribeProducts = () => scopedUnsubscribers.forEach((unsubscribe) => unsubscribe());
        },
        (error) => {
          console.error("Unable to resolve the authenticated author profile.", error);
          setPlan("free");
          setIsPlanLoading(false);
          setAllProducts([]);
          setIsBookPriceLoading(false);
        }
      );
    });

    return () => {
      clearCatalogSubscriptions();
      unsubscribeProfile?.();
      unsubscribeAuth();
    };
  }, []);

  const subscriptionCost = PLAN_COSTS[plan];
  const activeProducts = useMemo(() => (
    allProducts.filter((product) => Number.isFinite(product.unitPrice) && product.unitPrice > 0)
  ), [allProducts]);
  const bookPrice = useMemo(() => (
    activeProducts.length > 0
      ? activeProducts.reduce((sum, product) => sum + product.unitPrice, 0) / activeProducts.length
      : null
  ), [activeProducts]);
  const monthlyBudget = useMemo(() => (
    subscriptionCost + budget.paidTrafficBudget + budget.printAndEventsBudget
  ), [budget.paidTrafficBudget, budget.printAndEventsBudget, subscriptionCost]);

  return {
    allProducts,
    bookPrice,
    budget,
    isBookPriceLoading,
    isModalOpen,
    isPlanLoading,
    monthlyBudget,
    plan,
    setBudget,
    setIsModalOpen,
    subscriptionCost,
  };
}

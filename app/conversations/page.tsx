"use client";

import React from "react";
import Layout from "@/components/layout"; 
// 🔑 Notice 'section' is singular, matching your screenshot exactly!
import ConversationsPageContent from "@/components/section/conversations"; 

export const dynamic = 'force-dynamic';

export default function ConversationsPage() {
  return (
    <Layout>
      <ConversationsPageContent />
    </Layout>
  );
}
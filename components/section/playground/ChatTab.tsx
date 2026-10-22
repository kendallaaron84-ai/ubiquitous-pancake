"use client";

import React, { useState } from "react";
import { Send, Bot, User, ShieldAlert } from "lucide-react";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export default function AuthorSupportChat() {
  // 🔒 THE VAULT: Strict System Prompt Guardrails
  // This defines the persona and absolute boundaries for the Gemini model.
  const SYSTEM_PROMPT = `You are the KOBA-I Author Success Representative. Your tone is energetic, professional, and concise. 
  Your ONLY purpose is to assist authors with:
  1. SEO and marketing strategies for their books.
  2. WordPress troubleshooting and best practices.
  3. Utilizing the KOBA-I Audio Bridge plugin and Jubilee Works products.
  
  CRITICAL RULES:
  - Do NOT generate code.
  - Do NOT answer questions about history, science, coding, politics, or general trivia.
  - If a user asks about an off-topic subject, politely reply: "I am specialized in KOBA-I operations, WordPress, and book marketing. I cannot assist with that topic. How can we optimize your author platform today?"
  - Keep answers under 3 paragraphs. Use bullet points for actionable steps.`;
  void SYSTEM_PROMPT;

  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Welcome to KOBA-I Support! I'm here to help you optimize your WordPress site, scale your book marketing, and get the most out of your audio plugins. What are we tackling today?" }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage: Message = { role: "user", content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      // ⚡ GOOGLE GEMINI API HOOK INSTRUCTION
      // In your actual API route (/api/chat), you will pass the SYSTEM_PROMPT 
      // as the system instruction parameter to the Gemini endpoint, followed by the message history.
      
      // Simulated API Call for local UI testing
      setTimeout(() => {
        const offTopicKeywords = ["code", "python", "president", "history", "math"];
        const isOffTopic = offTopicKeywords.some(kw => userMessage.content.toLowerCase().includes(kw));
        
        const responseText = isOffTopic 
          ? "I am specialized in KOBA-I operations, WordPress, and book marketing. I cannot assist with that topic. How can we optimize your author platform today?"
          : "That is a great question. To maximize your KOBA-I Audio conversion rate, I recommend creating a dedicated landing page in WordPress and utilizing our shortcode directly below your book cover. Need help setting up the SEO metadata for that page?";

        setMessages(prev => [...prev, { role: "assistant", content: responseText }]);
        setIsLoading(false);
      }, 1000);

    } catch (error) {
      console.error("Chat Error:", error);
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[600px] bg-card border border-border rounded-xl shadow-sm overflow-hidden text-sm">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 bg-muted/50 border-b border-border">
        <div className="p-2 bg-primary/10 text-primary rounded-lg">
          <Bot className="w-5 h-5" />
        </div>
        <div>
          <h2 className="font-bold text-foreground">KOBA-I Success Representative</h2>
          <p className="text-xs text-muted-foreground">Automated Marketing & Platform Support</p>
        </div>
      </div>

      {/* Security Disclaimer */}
      <div className="bg-blue-500/10 text-blue-500 px-4 py-2 text-[10px] font-mono flex items-center gap-2 border-b border-blue-500/20">
        <ShieldAlert className="w-3 h-3" />
        Strict bounds active: Responds only to marketing, WordPress, and KOBA-I product inquiries.
      </div>

      {/* Message Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-xl p-3 ${
              msg.role === "user" 
                ? "bg-primary text-primary-foreground rounded-tr-none" 
                : "bg-muted/50 border border-border text-foreground rounded-tl-none"
            }`}>
              <div className="flex items-center gap-2 mb-1 opacity-70 text-[10px] uppercase tracking-wider font-bold">
                {msg.role === "user" ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                {msg.role}
              </div>
              <div className="leading-relaxed whitespace-pre-wrap">{msg.content}</div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-muted/50 border border-border rounded-xl rounded-tl-none p-3 text-muted-foreground flex items-center gap-1">
              <div className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce"></div>
              <div className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce delay-75"></div>
              <div className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce delay-150"></div>
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-4 bg-muted/30 border-t border-border">
        <form onSubmit={handleSendMessage} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about marketing, SEO, or KOBA-I Audio..."
            className="flex-1 bg-background border border-border rounded-lg px-4 py-2 focus:outline-none focus:border-primary transition-colors"
          />
          <button 
            type="submit" 
            disabled={!input.trim() || isLoading}
            className="bg-primary text-primary-foreground p-2 px-4 rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

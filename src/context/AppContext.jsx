import { createContext, useContext, useState, useEffect, useRef } from "react";
import {
  processQuery,
  getSuggestedQuestions,
  getDataDictionary,
  getRegistryInfo,
} from "../engine/queryEngine.js";
import { registerCSV, removeDataset } from "../engine/dataRegistry.js";
import {
  getRestrictions,
  getRoles,
  getAccessRequests,
  getPendingRequests,
  approveRequest,
  denyRequest,
  createAccessRequest,
} from "../engine/accessControl.js";

const AppContext = createContext(null);

export function AppProvider({ children }) {
  /* ── Tab & Role ── */
  const [activeTab, setActiveTab]       = useState("company");
  const [role, setRole]                 = useState("Owner");

  /* ── Dropdown open states ── */
  const [roleOpen, setRoleOpen]         = useState(false);
  const [bellOpen, setBellOpen]         = useState(false);
  const [registryOpen, setRegistryOpen] = useState(false);
  const [dictOpen, setDictOpen]         = useState(false);
  const [restrictOpen, setRestrictOpen] = useState(false);

  /* ── Input ── */
  const [input, setInput]               = useState("");

  /* ── Trust expand ── */
  const [expandedTrust, setExpandedTrust] = useState(null);

  /* ── Access requests from engine (synced via local state so UI re-renders) ── */
  const [accessRequests, setAccessRequests] = useState(() => getAccessRequests());

  /* ── Toast notification ── */
  const [notification, setNotification] = useState(null);

  /* ── Upload state ── */
  const [uploadedFile, setUploadedFile]         = useState(null);   // File object
  const [uploadedDatasetId, setUploadedDatasetId] = useState(null);
  const [uploadedDataType, setUploadedDataType] = useState("structured");

  /* ── Loading ── */
  const [isLoading, setIsLoading]       = useState(false);

  /* ── Per-role, per-tab chat storage ── */
  // chats are stored separately for company tab and upload tab.
  const [companyChats, setCompanyChats] = useState(() => {
    const initial = {};
    for (const r of getRoles()) {
      initial[r] = {
        chats: [{ id: 1, name: "New Chat", time: "just now", messages: [] }],
        activeChatId: 1,
      };
    }
    return initial;
  });

  // Upload tab gets a single flat chat (no sidebar history needed)
  const [uploadChat, setUploadChat] = useState({ messages: [] });

  /* ── Derived chat values ── */
  const isUploadTab    = activeTab === "upload";

  // Company-tab derived values
  const roleChats      = companyChats[role]?.chats ?? [];
  const activeChatId   = companyChats[role]?.activeChatId ?? roleChats[0]?.id;
  const activeChat     = roleChats.find((c) => c.id === activeChatId) ?? roleChats[0];

  // Active messages depend on which tab we're in
  const currentMessages = isUploadTab ? uploadChat.messages : (activeChat?.messages ?? []);
  const displayMessages = currentMessages;

  /* ── Derived engine values ── */
  const restrictions     = getRestrictions(role);   // from accessControl engine
  const pendingCount     = accessRequests.filter((r) => r.status === "pending").length;
  const suggestedQuestions = getSuggestedQuestions(activeTab, uploadedDatasetId, role);
  const dataDictionary     = getDataDictionary(activeTab, uploadedDatasetId);
  const registryInfo       = getRegistryInfo();
  const roles              = getRoles();

  /* ── Refs ── */
  const chatEndRef  = useRef(null);
  const fileRef     = useRef(null);
  const roleRef     = useRef(null);
  const bellRef     = useRef(null);
  const registryRef = useRef(null);
  const dictRef     = useRef(null);
  const restrictRef = useRef(null);

  /* ── Auto-scroll ── */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentMessages, isLoading]);

  /* ── Click-outside to close dropdowns ── */
  useEffect(() => {
    const handler = (e) => {
      if (roleRef.current     && !roleRef.current.contains(e.target))     setRoleOpen(false);
      if (bellRef.current     && !bellRef.current.contains(e.target))     setBellOpen(false);
      if (registryRef.current && !registryRef.current.contains(e.target)) setRegistryOpen(false);
      if (dictRef.current     && !dictRef.current.contains(e.target))     setDictOpen(false);
      if (restrictRef.current && !restrictRef.current.contains(e.target)) setRestrictOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  /* ── Toast ── */
  const showNotif = (msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  /* ── Push a message into the current active chat (tab-aware) ── */
  const pushMessage = (msg) => {
    if (activeTab === "upload") {
      // Upload tab: single flat chat
      setUploadChat((prev) => ({ messages: [...prev.messages, msg] }));
    } else {
      // Company tab: per-role, per-chat
      setCompanyChats((prev) => {
        const roleData = { ...prev[role] };
        roleData.chats = roleData.chats.map((c) => {
          if (c.id !== activeChatId) return c;
          const updated = { ...c, messages: [...c.messages, msg] };
          if (c.name === "New Chat" && msg.role === "user") {
            updated.name =
              msg.content.length > 30 ? msg.content.slice(0, 30) + "…" : msg.content;
          }
          return updated;
        });
        return { ...prev, [role]: roleData };
      });
    }
  };

  /* ── New Chat (company tab only) ── */
  const handleNewChat = () => {
    if (activeTab === "upload") {
      // In upload tab, "new chat" means clear messages and remove the uploaded file
      setUploadChat({ messages: [] });
      if (uploadedDatasetId) removeDataset(uploadedDatasetId);
      setUploadedFile(null);
      setUploadedDatasetId(null);
      setUploadedDataType("structured");
    } else {
      const newId = Date.now();
      setCompanyChats((prev) => {
        const roleData = { ...prev[role] };
        roleData.chats = [
          { id: newId, name: "New Chat", time: "just now", messages: [] },
          ...roleData.chats,
        ];
        roleData.activeChatId = newId;
        return { ...prev, [role]: roleData };
      });
    }
    setInput("");
    setExpandedTrust(null);
  };

  /* ── Switch Chat (company tab only) ── */
  const switchChat = (chatId) => {
    setCompanyChats((prev) => ({
      ...prev,
      [role]: { ...prev[role], activeChatId: chatId },
    }));
    setExpandedTrust(null);
  };

  /* ── Approve / Deny access request (engine + local state sync) ── */
  const handleAccess = (id, approved) => {
    if (approved) {
      approveRequest(id);
    } else {
      denyRequest(id);
    }
    // Sync access requests AND restrictions from engine (approval mutates both)
    setAccessRequests(getAccessRequests());
    showNotif(approved ? "Access approved successfully" : "Access request denied");
  };

  /* ── Send question through engine ── */
  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    pushMessage({
      role: "user",
      content: text,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    });
    setInput("");
    setIsLoading(true);

    // Build conversation context snapshot from the correct chat (last 5 messages)
    const ctxMessages = isUploadTab ? uploadChat.messages : (activeChat?.messages ?? []);
    const context = ctxMessages.slice(-5).map((m) => ({
      role: m.role,
      content: m.content ?? "",
    }));

    try {
      const result = await processQuery(text, role, context, activeTab, uploadedDatasetId);
      const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      if (result.type === "blocked") {
        pushMessage({
          role: "assistant",
          blocked: true,
          blockedColumns: result.blockedColumns.map((b) => b.col),
          blockedReasons: result.blockedColumns,
          time,
        });
      } else if (result.type === "error") {
        pushMessage({
          role: "assistant",
          content: result.message ?? "An unexpected error occurred.",
          isError: true,
          time,
        });
      } else if (result.type === "text") {
        pushMessage({
          role: "assistant",
          content: result.answer,
          trust: {
            source: result.source,
            method: "LLM answer from uploaded unstructured dataset",
            datasetsUsed: result.datasetName ? [result.datasetName] : [],
            columnsUsed: [],
            rowsAnalyzed: result.rowCount ?? 0,
            aiPowered: true,
          },
          time,
        });
      } else {
        // success
        pushMessage({
          role: "assistant",
          content: result.narrative,
          chartData: result.chartData,
          chartType: result.chartType,
          title: result.title,
          trust: result.trust,
          rawResult: result.rawResult,
          time,
        });
      }
    } catch (err) {
      pushMessage({
        role: "assistant",
        content: `Something went wrong while analyzing your data. Please try rephrasing your question.`,
        isError: true,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      });
    } finally {
      setIsLoading(false);
    }
  };

  /* ── CSV / Excel upload ── */
  const handleFileUpload = async (file, datasetType = "structured") => {
    if (!file) return;
    setIsLoading(true);

    // Reset upload chat so it starts fresh with the new dataset
    setUploadChat({ messages: [] });

    try {
      // Remove old upload from registry
      if (uploadedDatasetId) removeDataset(uploadedDatasetId);

      const entry = await registerCSV(file, {
        name: file.name.replace(/\.[^.]+$/, ""),
        type: datasetType,
      });
      setUploadedFile(file);
      setUploadedDatasetId(entry.id);
      setUploadedDataType(entry.type);

      // Build column summary narrative
      const colLines = entry.columns
        .slice(0, 12)
        .map((c) => `• **${c.name}** (${c.type})${c.description ? ": " + c.description : ""}`)
        .join("\n");
      const extra = entry.columns.length > 12 ? `\n• …and ${entry.columns.length - 12} more columns` : "";

      // Push welcome message directly into upload chat
      setUploadChat({
        messages: [{
          role: "assistant",
          content: `Successfully loaded **${entry.name}** — ${entry.rowCount.toLocaleString()} rows and ${entry.columns.length} columns detected.\n\n${colLines}${extra}\n\nAsk me anything about your data!`,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        }]
      });
    } catch (err) {
      setUploadChat({
        messages: [{
          role: "assistant",
          content: "Failed to load the file. Please make sure it's a valid CSV file.",
          isError: true,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        }]
      });
    } finally {
      setIsLoading(false);
    }
  };

  /* ── Request access (from AccessBlockedMsg) ── */
  const handleRequestAccess = (columns) => {
    createAccessRequest(role, columns, "Requested via query");
    setAccessRequests(getAccessRequests());
    showNotif("Access request sent to data owner");
  };

  return (
    <AppContext.Provider
      value={{
        // Tab
        activeTab, setActiveTab,
        // Role
        role, setRole, roles,
        // Dropdown open states
        roleOpen, setRoleOpen,
        bellOpen, setBellOpen,
        registryOpen, setRegistryOpen,
        dictOpen, setDictOpen,
        restrictOpen, setRestrictOpen,
        // Input
        input, setInput,
        // Trust
        expandedTrust, setExpandedTrust,
        // Access
        accessRequests, pendingCount,
        handleAccess, handleRequestAccess,
        // Notification
        notification, showNotif,
        // File
        uploadedFile, uploadedDatasetId,
        uploadedDataType, setUploadedDataType,
        handleFileUpload,
        // Loading
        isLoading,
        // Chats
        companyChats, roleChats, activeChatId, activeChat,
        uploadChat, isUploadTab,
        currentMessages, displayMessages,
        pushMessage, handleNewChat, switchChat,
        // Engine-derived (reactive)
        restrictions,
        suggestedQuestions,
        dataDictionary,
        registryInfo,
        // Refs
        chatEndRef, fileRef, roleRef, bellRef, registryRef, dictRef, restrictRef,
        // Main action
        handleSend,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}

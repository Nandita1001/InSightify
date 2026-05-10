import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import {
  getRestrictions,
  getRoles,
  setMyRestrictions,
  resetRestrictionIndex,
} from "../engine/accessControl.js";
import { authApi, accessApi, datasetApi, queryApi, setToken, getToken } from "../lib/api.js";
import { connectSocket, disconnectSocket } from "../lib/socket.js";

const AppContext = createContext(null);

export function AppProvider({ children }) {
  /* ── Auth ── */
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

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

  /* ── Access requests (Supabase-backed) ── */
  const [accessRequests, setAccessRequests] = useState([]);

  /* ── Toast notification ── */
  const [notification, setNotification] = useState(null);

  /* ── Upload state ── */
  const [uploadedFile, setUploadedFile]         = useState(null);
  const [uploadedDatasetId, setUploadedDatasetId] = useState(null);
  const [uploadedDataType, setUploadedDataType] = useState("structured");

  /* ── Loading ── */
  const [isLoading, setIsLoading]       = useState(false);

  /* ── Per-role, per-tab chat storage ── */
  const freshCompanyChats = () => {
    const initial = {};
    for (const r of getRoles()) {
      initial[r] = {
        chats: [{ id: 1, name: "New Chat", time: "just now", messages: [] }],
        activeChatId: 1,
      };
    }
    return initial;
  };

  const [companyChats, setCompanyChats] = useState(freshCompanyChats);
  const [uploadChat, setUploadChat] = useState({ messages: [] });

  /* ── Derived chat values ── */
  const isUploadTab    = activeTab === "upload";
  const roleChats      = companyChats[role]?.chats ?? [];
  const activeChatId   = companyChats[role]?.activeChatId ?? roleChats[0]?.id;
  const activeChat     = roleChats.find((c) => c.id === activeChatId) ?? roleChats[0];
  const currentMessages = isUploadTab ? uploadChat.messages : (activeChat?.messages ?? []);
  const displayMessages = currentMessages;

  /* ── Engine values hydrated from /api/query/* ── */
  const [suggestedQuestions, setSuggestedQuestions] = useState([]);
  const [dataDictionary, setDataDictionary]         = useState([]);
  const [registryInfo, setRegistryInfo]             = useState({ totalDatasets: 0, datasets: [] });

  const restrictions = getRestrictions(role, currentUser?.id);
  const pendingCount = accessRequests.filter((r) => r.status === "pending").length;
  const roles        = getRoles();

  /* ── Refs ── */
  const chatEndRef  = useRef(null);
  const fileRef     = useRef(null);
  const roleRef     = useRef(null);
  const bellRef     = useRef(null);
  const registryRef = useRef(null);
  const dictRef     = useRef(null);
  const restrictRef = useRef(null);

  /* ── Fetch access state from backend (requests + my effective restrictions) ── */
  const fetchAccessState = useCallback(async () => {
    try {
      const [{ requests }, { restrictions }] = await Promise.all([
        accessApi.listRequests(),
        accessApi.myRestrictions(),
      ]);
      setMyRestrictions(restrictions);
      setAccessRequests(requests);
    } catch (err) {
      console.error("Failed to fetch access state:", err);
    }
  }, []);

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

  /* ── JWT auth: restore session on mount by calling /api/auth/me ── */
  useEffect(() => {
    let mounted = true;

    const restore = async () => {
      if (!getToken()) {
        if (mounted) setIsAuthLoading(false);
        return;
      }
      try {
        const { user } = await authApi.me();
        if (!mounted) return;
        setCurrentUser(user);
        setRole(user.role);
        setIsAuthenticated(true);
      } catch {
        setToken(null);
      } finally {
        if (mounted) setIsAuthLoading(false);
      }
    };

    restore();
    return () => { mounted = false; };
  }, []);

  /* ── Real-time access requests: socket.io listener + initial load ── */
  useEffect(() => {
    if (!isAuthenticated) return;

    fetchAccessState();

    const token = getToken();
    if (!token) return;

    const socket = connectSocket(token);
    const handler = () => fetchAccessState();
    socket.on("access_requests:changed", handler);

    return () => {
      socket.off("access_requests:changed", handler);
    };
  }, [isAuthenticated, fetchAccessState]);

  /* ── Hydrate registry/dictionary/suggestions whenever inputs change ── */
  const refreshRegistry = useCallback(async () => {
    if (!isAuthenticated) return;
    try { setRegistryInfo(await queryApi.registry()); }
    catch (err) { console.error("Failed to load registry:", err); }
  }, [isAuthenticated]);

  useEffect(() => { refreshRegistry(); }, [refreshRegistry]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let alive = true;
    // Clear synchronously so the prior tab's suggestions/dictionary don't
    // flash for the ~100-300ms the async refetch is in flight.
    setSuggestedQuestions([]);
    setDataDictionary([]);
    (async () => {
      try {
        const [{ suggestions }, { dictionary }] = await Promise.all([
          queryApi.suggestions({ activeTab, datasetId: uploadedDatasetId }),
          queryApi.dictionary({ activeTab, datasetId: uploadedDatasetId }),
        ]);
        if (!alive) return;
        setSuggestedQuestions(suggestions ?? []);
        setDataDictionary(dictionary ?? []);
      } catch (err) {
        console.error("Failed to load query metadata:", err);
      }
    })();
    return () => { alive = false; };
  }, [isAuthenticated, activeTab, uploadedDatasetId, role]);

  /* ── Wipe all per-user UI state. Called on logout AND before applying a
        new session, so the next user never inherits the previous user's
        chat history, uploaded-dataset reference, or hydrated metadata. ── */
  const resetSessionState = () => {
    setCompanyChats(freshCompanyChats());
    setUploadChat({ messages: [] });
    setUploadedFile(null);
    setUploadedDatasetId(null);
    setUploadedDataType("structured");
    setInput("");
    setExpandedTrust(null);
    setAccessRequests([]);
    setSuggestedQuestions([]);
    setDataDictionary([]);
    setRegistryInfo({ totalDatasets: 0, datasets: [] });
    setActiveTab("company");
    setBellOpen(false);
    setRoleOpen(false);
    setRegistryOpen(false);
    setDictOpen(false);
    setRestrictOpen(false);
    resetRestrictionIndex();
  };

  /* ── Auth functions (backend JWT) ── */
  const applySession = ({ user, token }) => {
    // Wipe any remnants of a previous session before installing the new one.
    resetSessionState();
    setToken(token);
    setCurrentUser(user);
    setRole(user.role);
    setIsAuthenticated(true);
  };

  const login = async (email, password) => {
    try {
      const data = await authApi.login({ email, password });
      applySession(data);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message ?? "Login failed" };
    }
  };

  const signup = async (name, email, password, selectedRole) => {
    try {
      const data = await authApi.signup({ name, email, password, role: selectedRole });
      applySession(data);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message ?? "Signup failed" };
    }
  };

  const logout = async () => {
    try { await authApi.logout(); } catch { /* ignore — stateless JWT */ }
    disconnectSocket();
    setToken(null);
    resetSessionState();
    setCurrentUser(null);
    setIsAuthenticated(false);
    setRole("Owner");
    // The GuestRoute guard will redirect to /login on the next render.
  };

  /* ── Toast ── */
  const showNotif = (msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  /* ── Push a message into the current active chat (tab-aware) ── */
  const pushMessage = (msg) => {
    if (activeTab === "upload") {
      setUploadChat((prev) => ({ messages: [...prev.messages, msg] }));
    } else {
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

  /* ── New Chat ── */
  const handleNewChat = () => {
    if (activeTab === "upload") {
      setUploadChat({ messages: [] });
      if (uploadedDatasetId) {
        datasetApi.remove(uploadedDatasetId).catch(() => {}).finally(refreshRegistry);
      }
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

  /* ── Switch Chat ── */
  const switchChat = (chatId) => {
    setCompanyChats((prev) => ({
      ...prev,
      [role]: { ...prev[role], activeChatId: chatId },
    }));
    setExpandedTrust(null);
  };

  /* ── Approve / Deny access request ── */
  const handleAccess = async (id, approved) => {
    const newStatus = approved ? "approved" : "denied";
    // Optimistic UI: flip the status locally so the buttons disappear
    // immediately. Server-confirm in the background; resync on completion.
    setAccessRequests((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, status: newStatus, resolved_at: new Date().toISOString() } : r
      )
    );
    try {
      await accessApi.resolveRequest(id, newStatus);
      await fetchAccessState();
      showNotif(approved ? "Access approved successfully" : "Access request denied");
    } catch {
      // Roll back by refetching authoritative state
      await fetchAccessState();
      showNotif("Failed to process request. Please try again.");
    }
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

    const ctxMessages = isUploadTab ? uploadChat.messages : (activeChat?.messages ?? []);
    const context = ctxMessages.slice(-5).map((m) => ({
      role: m.role,
      content: m.content ?? "",
    }));

    try {
      const result = await queryApi.run({
        question: text,
        activeTab,
        datasetId: uploadedDatasetId ?? null,
        context,
      });
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
    } catch {
      pushMessage({
        role: "assistant",
        content: "Something went wrong while analyzing your data. Please try rephrasing your question.",
        isError: true,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      });
    } finally {
      setIsLoading(false);
    }
  };

  /* ── CSV / Excel upload (Multer multipart → server profiles + persists) ── */
  const handleFileUpload = async (file, datasetType = "structured") => {
    if (!file) return;
    setIsLoading(true);
    setUploadChat({ messages: [] });

    try {
      // If a previous upload is in scope, remove it server-side.
      if (uploadedDatasetId) {
        try { await datasetApi.remove(uploadedDatasetId); } catch { /* ignore */ }
      }

      const { dataset } = await datasetApi.upload(file, datasetType);
      setUploadedFile(file);
      setUploadedDatasetId(dataset.id);
      setUploadedDataType(dataset.type);
      await refreshRegistry();

      const colLines = dataset.columns
        .slice(0, 12)
        .map((c) => `• **${c.name}** (${c.type})${c.description ? ": " + c.description : ""}`)
        .join("\n");
      const extra = dataset.columns.length > 12 ? `\n• …and ${dataset.columns.length - 12} more columns` : "";

      setUploadChat({
        messages: [{
          role: "assistant",
          content: `Successfully loaded **${dataset.name}** — ${dataset.rowCount.toLocaleString()} rows and ${dataset.columns.length} columns detected.\n\n${colLines}${extra}\n\nAsk me anything about your data!`,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        }]
      });
    } catch (err) {
      setUploadChat({
        messages: [{
          role: "assistant",
          content: err?.message ?? "Failed to load the file. Please make sure it's a valid CSV file.",
          isError: true,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        }]
      });
    } finally {
      setIsLoading(false);
    }
  };

  /* ── Request access (from AccessBlockedMsg) ── */
  const handleRequestAccess = async (columns) => {
    try {
      await accessApi.createRequest({ columns, reason: "Requested via query" });
      await fetchAccessState();
      showNotif("Access request sent to data owner");
    } catch {
      showNotif("Failed to send access request. Please try again.");
    }
  };

  return (
    <AppContext.Provider
      value={{
        // Auth
        isAuthenticated, isAuthLoading, currentUser,
        login, signup, logout,
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

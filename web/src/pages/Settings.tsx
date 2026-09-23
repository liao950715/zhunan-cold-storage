import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage, get, patch, post } from "../api/client";
import type { UserItem } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Card, Field, Message, PageTitle } from "../components/ui";
import { useDialog } from "../components/ConfirmDialog";

/** 系統設定：使用者與權限管理（僅管理員；後端亦強制）。 */
export default function Settings() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const dialog = useDialog();
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const users = useQuery({ queryKey: ["users"], queryFn: () => get<{ items: UserItem[] }>("/users"), enabled: user?.role === "ADMIN" });
  const [form, setForm] = useState({ username: "", password: "", displayName: "", role: "STAFF" as "STAFF" | "ADMIN" });

  const create = useMutation({
    mutationFn: () => post<UserItem>("/users", form),
    onSuccess: async (u) => {
      await qc.invalidateQueries({ queryKey: ["users"] });
      setMsg({ kind: "ok", text: `已建立帳號 ${u.username}` });
      setForm({ username: "", password: "", displayName: "", role: "STAFF" });
    },
    onError: (e) => setMsg({ kind: "error", text: errorMessage(e) }),
  });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<UserItem> & { password?: string } }) => patch<UserItem>(`/users/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
    onError: (e) => setMsg({ kind: "error", text: errorMessage(e) }),
  });

  if (user?.role !== "ADMIN") return <Message kind="warn">此頁僅管理員可用。</Message>;

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <div className="space-y-3">
      <PageTitle sub="管理員與工作人員帳號；密碼以雜湊儲存">系統設定</PageTitle>
      {msg && <Message kind={msg.kind}>{msg.text}</Message>}
      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <Card title="使用者">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">帳號</th><th>名稱</th><th>角色</th><th>狀態</th><th></th></tr></thead>
            <tbody>
              {users.data?.items.map((u) => (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="py-1.5 font-mono">{u.username}</td>
                  <td>{u.displayName}</td>
                  <td>
                    <select className="input mt-0 w-28" value={u.role} disabled={u.id === user.id} onChange={(e) => update.mutate({ id: u.id, data: { role: e.target.value as UserItem["role"] } })}>
                      <option value="ADMIN">管理員</option><option value="STAFF">工作人員</option>
                    </select>
                  </td>
                  <td>{u.status === "ACTIVE" ? "啟用" : <span className="text-slate-400">停用</span>}</td>
                  <td className="text-right whitespace-nowrap">
                    <button className="text-sky-700 hover:underline" onClick={async () => { const p = await dialog.prompt(`為 ${u.username} 設定新密碼（至少 6 碼）`); if (p) update.mutate({ id: u.id, data: { password: p } }); }}>重設密碼</button>
                    {u.id !== user.id && <button className="ml-3 text-slate-500 hover:underline" onClick={() => update.mutate({ id: u.id, data: { status: u.status === "ACTIVE" ? "DISABLED" : "ACTIVE" } })}>{u.status === "ACTIVE" ? "停用" : "啟用"}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="新增帳號">
          <form onSubmit={submit} className="space-y-2">
            <Field label="帳號 *"><input className="input" required minLength={3} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
            <Field label="密碼 *（至少 6 碼）"><input type="password" className="input" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
            <Field label="顯示名稱 *"><input className="input" required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
            <Field label="角色"><select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "STAFF" | "ADMIN" })}><option value="STAFF">工作人員</option><option value="ADMIN">管理員</option></select></Field>
            <button className="btn-primary" type="submit" disabled={create.isPending}>建立</button>
          </form>
        </Card>
      </div>
    </div>
  );
}

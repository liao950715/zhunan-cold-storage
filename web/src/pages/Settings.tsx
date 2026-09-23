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

  const reset = useMutation({
    mutationFn: () => post("/admin/reset-demo", { confirm: "RESET" }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      setMsg({ kind: "ok", text: "已重置為展示資料：帳號、兩座冷凍庫、20 種商品、4 批示範庫存。" });
    },
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
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-[16px]">
            <thead className="text-left text-ink-2"><tr><th className="py-1">帳號</th><th>名稱</th><th>角色</th><th>狀態</th><th></th></tr></thead>
            <tbody>
              {users.data?.items.map((u) => (
                <tr key={u.id} className="border-t border-line">
                  <td className="py-1.5 font-mono">{u.username}</td>
                  <td>{u.displayName}</td>
                  <td>
                    <select className="input mt-0 w-28" value={u.role} disabled={u.id === user.id} onChange={(e) => update.mutate({ id: u.id, data: { role: e.target.value as UserItem["role"] } })}>
                      <option value="ADMIN">管理員</option><option value="STAFF">工作人員</option>
                    </select>
                  </td>
                  <td>{u.status === "ACTIVE" ? "啟用" : <span className="text-ink-2">停用</span>}</td>
                  <td className="text-right whitespace-nowrap">
                    <button className="text-brand-deep underline" onClick={async () => { const p = await dialog.prompt(`為 ${u.username} 設定新密碼（至少 6 碼）`); if (p) update.mutate({ id: u.id, data: { password: p } }); }}>重設密碼</button>
                    {u.id !== user.id && <button className="ml-3 text-ink-2 hover:underline" onClick={() => update.mutate({ id: u.id, data: { status: u.status === "ACTIVE" ? "DISABLED" : "ACTIVE" } })}>{u.status === "ACTIVE" ? "停用" : "啟用"}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Card>
        <div className="space-y-3">
        <Card title="展示用">
          <p className="muted">把所有庫存、紀錄、盤點與布局清掉，回到初始示範資料。展示前使用；正式營運後請不要按。</p>
          <button type="button" className="btn mt-3 text-bad" disabled={reset.isPending} onClick={async () => { if (await dialog.confirm("重置為展示資料", "會刪除目前所有庫存、異動紀錄、盤點單與布局變更，並重建示範帳號。確定要重置嗎？")) reset.mutate(); }}>{reset.isPending ? "重置中…" : "重置為展示資料"}</button>
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
    </div>
  );
}

"""
Cover Quiz — Admin covers signalées
=====================================
pip install streamlit pandas python-dotenv supabase
streamlit run db_tools/admin_reported.py
"""

import os
import pandas as pd
import streamlit as st
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

# ── Page ──────────────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Cover Quiz — Admin",
    page_icon="🎵",
    layout="wide",
)

st.markdown("""
<style>
    .block-container { padding-top: 2rem; }
    [data-testid="stDataEditor"] { border-radius: 8px; }
</style>
""", unsafe_allow_html=True)

# ── Client ────────────────────────────────────────────────────────────────────
@st.cache_resource
def get_client():
    return create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_KEY"],
    )

@st.cache_data(ttl=0)
def fetch_reported():
    res = (
        get_client()
        .table("albums")
        .select("id,artist,album,genre,cover_url,issue")
        .not_.is_("issue", "null")
        .execute()
    )
    return res.data

# ── Header ────────────────────────────────────────────────────────────────────
st.title("🎵 Cover Quiz — Admin")
st.caption("Gestion des covers signalées")

if st.button("🔄 Rafraîchir", type="secondary"):
    st.cache_data.clear()
    st.rerun()

st.divider()

data = fetch_reported()

if not data:
    st.success("✅ Aucun album signalé — base propre.")
    st.stop()

# ── Métriques ─────────────────────────────────────────────────────────────────
col_m1, col_m2, col_m3 = st.columns(3)
col_m1.metric("Albums signalés", len(data))
col_m2.metric("Artistes concernés", len({a["artist"] for a in data}))
col_m3.metric("Genres", len({a["genre"] for a in data}))

st.divider()

# ── Table éditable ────────────────────────────────────────────────────────────
st.subheader("Albums signalés")
st.caption("Modifie directement les cellules, coche 🗑 pour marquer à supprimer, puis applique les actions.")

df_orig = pd.DataFrame(data)
df_edit = df_orig.copy()
df_edit.insert(0, "🗑", False)

edited = st.data_editor(
    df_edit,
    column_config={
        "🗑":        st.column_config.CheckboxColumn("🗑",       width=40),
        "id":        st.column_config.NumberColumn(  "ID",       disabled=True, width=60),
        "cover_url": st.column_config.ImageColumn(   "Cover",    width=80),
        "artist":    st.column_config.TextColumn(    "Artiste",  width=200),
        "album":     st.column_config.TextColumn(    "Album",    width=280),
        "genre":     st.column_config.SelectboxColumn("Genre",   options=["FR", "US"], width=80),
        "issue":     st.column_config.TextColumn(    "Issue",    disabled=True, width=140),
    },
    hide_index=True,
    use_container_width=True,
    num_rows="fixed",
)

# ── Actions ───────────────────────────────────────────────────────────────────
st.divider()
col1, col2, col3, col4 = st.columns([1.4, 1.4, 1.4, 1.4])

# 1. Sauvegarder les modifications
with col1:
    if st.button("💾 Sauvegarder les modifications", type="primary", use_container_width=True):
        sb = get_client()
        saved = 0
        for i, row in edited.iterrows():
            orig = df_orig.iloc[i]
            updates = {
                f: row[f]
                for f in ["artist", "album", "genre", "cover_url"]
                if str(row[f]) != str(orig[f])
            }
            if updates:
                sb.table("albums").update(updates).eq("id", int(row["id"])).execute()
                saved += 1
        if saved:
            st.toast(f"✅ {saved} album(s) mis à jour", icon="✅")
            st.cache_data.clear()
            st.rerun()
        else:
            st.toast("Aucune modification détectée")

# 2. Supprimer les lignes cochées
with col2:
    to_delete = edited[edited["🗑"] == True]
    label = f"🗑️ Supprimer ({len(to_delete)} séléc.)" if len(to_delete) else "🗑️ Supprimer la sélection"
    del_disabled = len(to_delete) == 0

    if st.button(label, disabled=del_disabled, use_container_width=True):
        st.session_state["confirm_delete"] = True

    if st.session_state.get("confirm_delete"):
        names = ", ".join(f"**{r['artist']} — {r['album']}**" for _, r in to_delete.iterrows())
        st.error(f"Supprimer définitivement : {names} ?")
        c_yes, c_no = st.columns(2)
        if c_yes.button("✅ Confirmer", use_container_width=True):
            sb = get_client()
            for _, row in to_delete.iterrows():
                sb.table("albums").delete().eq("id", int(row["id"])).execute()
            st.session_state.pop("confirm_delete", None)
            st.toast(f"🗑️ {len(to_delete)} album(s) supprimé(s)", icon="🗑️")
            st.cache_data.clear()
            st.rerun()
        if c_no.button("✗ Annuler", use_container_width=True):
            st.session_state.pop("confirm_delete", None)
            st.rerun()

# 3. Marquer les cochés comme résolus
with col3:
    res_disabled = len(to_delete) == 0
    res_label = f"✅ Résolu ({len(to_delete)} séléc.)" if len(to_delete) else "✅ Marquer résolu"
    if st.button(res_label, disabled=res_disabled, use_container_width=True):
        sb = get_client()
        for _, row in to_delete.iterrows():
            sb.table("albums").update({"issue": None}).eq("id", int(row["id"])).execute()
        st.toast(f"✅ {len(to_delete)} signalement(s) effacé(s)", icon="✅")
        st.cache_data.clear()
        st.rerun()

# 4. Tout marquer résolu
with col4:
    if st.button("✅ Tout marquer résolu", use_container_width=True):
        sb = get_client()
        for a in data:
            sb.table("albums").update({"issue": None}).eq("id", a["id"]).execute()
        st.toast("✅ Tous les signalements effacés", icon="✅")
        st.cache_data.clear()
        st.rerun()

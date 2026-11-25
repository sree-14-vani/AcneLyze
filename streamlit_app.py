import streamlit as st

from backend.app.ai import chat_available, gemini_configured
from backend.app.config import settings
from backend.app.detection import model_status as detection_status
from backend.app.enhancement import model_status as enhancement_status
from backend.app.skin_condition import model_status as condition_status

st.set_page_config(page_title="AcneLyze", page_icon=":material/face:", layout="wide")

st.title("AcneLyze")
st.caption("AI-assisted platform for skin analysis and personalized skincare guidance")

st.info(
    "The React frontend remains the primary interface. This Streamlit app serves the "
    "unchanged FastAPI backend at /api and shows its live status.",
    icon=":material/info:",
)

enhancement = enhancement_status()
detection = detection_status()
condition = condition_status()

services = {
    "Image validation": True,
    "Face detection": True,
    "Skin analysis": True,
    "Image enhancement": enhancement["gfpgan_active"],
    "Acne detection": detection["yolo_active"],
    "Skin condition classification": condition["active"],
    "AI chat": chat_available(),
}

status_col, version_col, upload_col, chat_col = st.columns(4)
status_col.metric("API", "ok")
version_col.metric("Version", settings.version)
upload_col.metric("Upload limit", f"{settings.max_upload_mb} MB")
chat_col.metric("AI chat", "Ready" if chat_available() else "Not configured")

with st.container(border=True):
    st.subheader("Services")
    for name, available in services.items():
        st.write(f"{name}: {'ready' if available else 'unavailable'}")

with st.expander("Runtime details"):
    st.json(
        {
            "version": settings.version,
            "languages": ["en", "hi", "kn", "te"],
            "limits": {
                "max_upload_mb": settings.max_upload_mb,
                "min_dimension": settings.min_image_dimension,
                "max_dimension": settings.max_image_dimension,
                "enhancement_max_dimension": settings.enhancement_max_dimension,
            },
            "capabilities": {
                "chat": chat_available(),
                "gemini_configured": gemini_configured(),
                "enhancement": enhancement,
                "detection": detection,
                "skin_condition": condition,
            },
        }
    )

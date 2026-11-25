from pathlib import Path

import streamlit as st
from starlette.routing import Mount

from cloud_api import PrefixedFastAPI, fastapi_app

app = st.App(
    str(Path(__file__).resolve().with_name("streamlit_app.py")),
    routes=[Mount("/api", app=PrefixedFastAPI(fastapi_app, "/api"))],
)

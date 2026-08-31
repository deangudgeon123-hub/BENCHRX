from pydantic import BaseModel


class TriggerPayload(BaseModel):
    run_id: str

from pydantic import BaseModel
from uuid import UUID


class TriggerPayload(BaseModel):
    run_id: UUID

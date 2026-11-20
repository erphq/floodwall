"""A LangGraph agent whose tool calls go through Floodwall.

    pip install langgraph langchain-anthropic
    FLOODWALL_KEY=fw_live_... FLOODWALL_PLANE=pl_... python3 sdk/examples/langgraph-agent.py [--apply]

The client comes from this checkout (sdk/python). In your own project:
pip install floodwall[langgraph] langchain-anthropic, and drop the sys.path line.

Two ways to guard a change, both in `floodwall.langgraph`:

* `guarded_tool` wraps a function you hand to a ReAct agent as a tool. The tool
  asks the plane first, and a refusal comes back to the model as plain text.
* `guard_node` is a graph node: an earlier node puts a change in the state,
  this one asks the plane and only then runs `apply`.

Without --apply nothing runs a command, and without FLOODWALL_KEY the graph part
is skipped. The model part needs ANTHROPIC_API_KEY.
"""

import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, TypedDict

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "python"))
from floodwall import Floodwall  # noqa: E402
from floodwall.langgraph import guard_node, guarded_tool  # noqa: E402

APPLY = "--apply" in sys.argv


class State(TypedDict, total=False):
    proposed_change: Dict[str, Any]
    floodwall: Dict[str, Any]


def shell(command):
    if not APPLY:
        return f"would run: {command}"
    return subprocess.run(command, shell=True, check=True, capture_output=True, text=True).stdout


def scale_deployment(deployment: str, replicas: int) -> str:
    """Scale a Kubernetes deployment to a number of replicas."""
    return shell(f"kubectl scale deployment/{deployment} --replicas={replicas}")


def main():
    if not os.environ.get("FLOODWALL_KEY"):
        print("set FLOODWALL_KEY and FLOODWALL_PLANE to ask a plane")
        return
    fw = Floodwall(
        api_key=os.environ["FLOODWALL_KEY"],
        plane=os.environ["FLOODWALL_PLANE"],
        agent=os.environ.get("FLOODWALL_AGENT", "langgraph-agent"),
        base_url=os.environ.get("FLOODWALL_URL", "https://api.floodwall.ai"),
    )

    # 1. A guarded tool, for an agent that picks its own tools.
    scale = guarded_tool(
        fw,
        scale_deployment,
        change=lambda deployment, replicas: {
            "action": {"kind": "scale", "resource": deployment, "replicas": replicas},
            "context": f"scale {deployment} to {replicas}",
        },
        name="scale_deployment",
    )
    print("direct call:", scale("web", 6))

    if os.environ.get("ANTHROPIC_API_KEY"):
        from langchain_anthropic import ChatAnthropic
        from langgraph.prebuilt import create_react_agent

        agent = create_react_agent(ChatAnthropic(model="claude-sonnet-4-5"), [scale])
        reply = agent.invoke({"messages": [("user", "The web deployment is slow, scale it to 6 replicas.")]})
        print(reply["messages"][-1].content)

    # 2. A guard node, for a graph that proposes a change and then applies it.
    from langgraph.graph import END, START, StateGraph

    graph = StateGraph(State)
    graph.add_node("propose", lambda state: {"proposed_change": {"action": {"kind": "scale", "resource": "web", "replicas": 6}}})
    graph.add_node("guard", guard_node(fw, apply=lambda state: scale_deployment("web", 6)))
    graph.add_edge(START, "propose")
    graph.add_edge("propose", "guard")
    graph.add_edge("guard", END)
    print("graph:", graph.compile().invoke({})["floodwall"])


if __name__ == "__main__":
    main()

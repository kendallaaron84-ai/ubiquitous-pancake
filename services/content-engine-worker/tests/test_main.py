import importlib.util
import json
import os
import sys
import types as python_types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch


WORKER_PATH = Path(__file__).resolve().parents[1] / "main.py"


class _Config:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


class _Part:
    @staticmethod
    def from_uri(**kwargs):
        return kwargs

    @staticmethod
    def from_bytes(**kwargs):
        return kwargs


class _CloudClient:
    def __init__(self, *args, **kwargs):
        self.models = MagicMock()


def _install_import_stubs():
    functions_framework = python_types.ModuleType("functions_framework")
    functions_framework.http = lambda function: function
    sys.modules["functions_framework"] = functions_framework

    requests = python_types.ModuleType("requests")
    requests.Response = type("Response", (), {})
    requests.Session = type("Session", (), {})
    requests.get = MagicMock()
    sys.modules["requests"] = requests

    google = python_types.ModuleType("google")
    google.__path__ = []
    genai = python_types.ModuleType("google.genai")
    genai.Client = _CloudClient
    genai_types = python_types.ModuleType("google.genai.types")
    genai_types.GenerateContentConfig = _Config
    genai_types.ImageConfig = _Config
    genai_types.Modality = type("Modality", (), {"IMAGE": "IMAGE"})
    genai_types.Part = _Part
    genai.types = genai_types
    google.genai = genai

    cloud = python_types.ModuleType("google.cloud")
    cloud.__path__ = []
    firestore = python_types.ModuleType("google.cloud.firestore")
    firestore.SERVER_TIMESTAMP = object()
    firestore.DELETE_FIELD = object()
    firestore.Increment = lambda amount: ("increment", amount)
    firestore.transactional = lambda function: function
    firestore.Client = _CloudClient
    secretmanager = python_types.ModuleType("google.cloud.secretmanager")
    secretmanager.SecretManagerServiceClient = _CloudClient
    storage = python_types.ModuleType("google.cloud.storage")
    storage.Client = _CloudClient
    cloud.firestore = firestore
    cloud.secretmanager = secretmanager
    cloud.storage = storage

    sys.modules["google"] = google
    sys.modules["google.genai"] = genai
    sys.modules["google.genai.types"] = genai_types
    sys.modules["google.cloud"] = cloud
    sys.modules["google.cloud.firestore"] = firestore
    sys.modules["google.cloud.secretmanager"] = secretmanager
    sys.modules["google.cloud.storage"] = storage


def _load_worker():
    _install_import_stubs()
    os.environ["CONTENT_FIRESTORE_PROJECT_ID"] = "worker-test-project"
    os.environ["KOBA_TASK_HMAC_SECRET"] = "x" * 40
    spec = importlib.util.spec_from_file_location("koba_content_worker_under_test", WORKER_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


worker = _load_worker()


class FakeSnapshot:
    def __init__(self, document_id, data=None):
        self.id = document_id
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data or {})


class FakeDocumentReference:
    def __init__(self, database, path):
        self.database = database
        self.path = tuple(path)

    def get(self, transaction=None):
        del transaction
        return FakeSnapshot(self.path[-1], self.database.store.get(self.path))

    def collection(self, name):
        return FakeCollectionReference(self.database, self.path + (name,))

    def update(self, updates):
        self.database.updates.append((self.path, dict(updates)))


class FakeCollectionReference:
    def __init__(self, database, path):
        self.database = database
        self.path = tuple(path)
        self._limit = None

    def document(self, document_id):
        return FakeDocumentReference(self.database, self.path + (document_id,))

    def order_by(self, field):
        self.order_field = field
        return self

    def limit(self, count):
        self._limit = count
        return self

    def stream(self):
        matches = []
        for path, data in self.database.store.items():
            if len(path) == len(self.path) + 1 and path[:-1] == self.path:
                matches.append(FakeSnapshot(path[-1], data))
        matches.sort(key=lambda snapshot: snapshot.to_dict().get("chunkIndex", 0))
        return matches[: self._limit] if self._limit else matches


class FakeFirestore:
    def __init__(self, store=None):
        self.store = store or {}
        self.updates = []

    def collection(self, name):
        return FakeCollectionReference(self, (name,))

    def transaction(self):
        return MagicMock()


class FakeResponse:
    def __init__(self, url, status_code=200, payload=None):
        self.url = url
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeWordPressSession:
    def __init__(self, base_url):
        self.base_url = base_url
        self.calls = []

    def request(self, method, url, allow_redirects=False, **kwargs):
        self.calls.append((method, url, kwargs))
        if method == "GET":
            return FakeResponse(url, payload=[])
        return FakeResponse(url, payload={"id": 41})


class FakeRequest:
    method = "POST"

    def __init__(self, retry_count="0"):
        self.headers = {"X-CloudTasks-TaskRetryCount": retry_count}


def story_store(*, include_safe=True, include_restricted=False, cross_tenant=False):
    base = {
        ("nexus_story_worlds", "universe_01"): {
            "studioKey": "KOBA-001",
            "authorId": "author_01",
            "status": "active",
            "title": "The Lantern Realm",
            "genre": "Fantasy",
        },
        ("nexus_story_worlds", "universe_01", "reference_guides", "guide_0001"): {
            "studioKey": "KOBA-001",
            "authorId": "author_01",
            "universeId": "universe_01",
            "status": "ready",
            "version": 3,
            "spoilerPolicy": {
                "thingsSafeToDiscuss": "The harbor and its lantern keepers",
                "thingsNeverToReveal": "Queen Iris is the traitor",
            },
        },
    }
    prefix = (
        "nexus_story_worlds",
        "universe_01",
        "reference_guides",
        "guide_0001",
        "versions",
        "3",
        "chunks",
    )
    if include_safe:
        base[prefix + ("chunk_0001",)] = {
            "studioKey": "OTHER" if cross_tenant else "KOBA-001",
            "authorId": "author_01",
            "universeId": "universe_01",
            "referenceGuideId": "guide_0001",
            "referenceGuideVersion": 3,
            "spoilerLevel": "public_safe",
            "chunkIndex": 0,
            "text": "Mara tends the silver harbor lantern during winter storms.",
        }
    if include_restricted:
        base[prefix + ("chunk_0002",)] = {
            "studioKey": "KOBA-001",
            "authorId": "author_01",
            "universeId": "universe_01",
            "referenceGuideId": "guide_0001",
            "referenceGuideVersion": 3,
            "spoilerLevel": "restricted",
            "chunkIndex": 1,
            "text": "Queen Iris is the traitor.",
        }
    return base


def nexus_blueprint(content_source="story_world"):
    data = {
        "schemaVersion": 1,
        "contentSource": content_source,
        "authorId": "author_01",
        "authorEmail": "author@example.com",
        "topicTitle": "Why the harbor lantern matters",
        "targetAudience": "Fantasy readers",
        "resolvedGoal": "create_intrigue",
        "primaryStrategyGuideId": "strategy_intrigue",
        "supportingStrategyGuideId": None,
        "seoKeywords": {"primary": "harbor lantern"},
        "seoTitle": "Harbor Lantern",
        "seoDescription": "A guide to the harbor lantern.",
        "blogPostHtml": "<h2>Harbor Lantern</h2><p>Mara tends the silver harbor lantern.</p>",
        "focusKeyword": "harbor lantern",
        "facebookCopy": "Discover the harbor.",
        "instagramCopy": "The lantern waits.",
        "imagePrompt": "A silver lantern over a winter harbor",
        "featuredMediaId": 7,
        "featuredMediaUrl": "https://example.test/media/7.jpg",
    }
    if content_source == "story_world":
        data.update(
            {
                "universeId": "universe_01",
                "referenceGuideId": "guide_0001",
                "referenceGuideVersion": 3,
                "knowledgeChunkIds": ["chunk_0001"],
            }
        )
    return data


class WorkerContractTests(unittest.TestCase):
    def setUp(self):
        worker.db = FakeFirestore()

    def test_business_brand_route_loads_no_story_world_context(self):
        data = nexus_blueprint("business_brand")
        profile = {"businessName": "KOBA", "coreValues": "Trust", "toneOfVoice": "Clear", "targetAudience": "Authors"}
        with patch.object(worker, "fetch_business_profile", return_value=profile) as fetch_profile, patch.object(
            worker, "retrieve_story_world_knowledge"
        ) as retrieve_story:
            business, story, strategy = worker.resolve_nexus_generation_context(data, "KOBA-001")
        self.assertEqual(profile, business)
        self.assertIsNone(story)
        self.assertEqual("strategy_intrigue", strategy[0]["strategyGuideId"])
        fetch_profile.assert_called_once()
        retrieve_story.assert_not_called()

    def test_story_world_requires_source_and_grounding_metadata(self):
        malformed = nexus_blueprint()
        malformed.pop("contentSource")
        with self.assertRaises(worker.PermanentTaskError):
            worker.resolve_blueprint_generation_mode(malformed)

        for missing_field in ("universeId", "referenceGuideId", "referenceGuideVersion", "knowledgeChunkIds"):
            with self.subTest(missing_field=missing_field):
                data = nexus_blueprint()
                data.pop(missing_field)
                with self.assertRaises(worker.PermanentTaskError):
                    worker.resolve_nexus_generation_context(data, "KOBA-001")

    def test_reference_guide_active_version_must_match_blueprint(self):
        data = nexus_blueprint()
        data["referenceGuideVersion"] = 2
        worker.db = FakeFirestore(story_store())
        with self.assertRaisesRegex(worker.PermanentTaskError, "changed after"):
            worker.resolve_nexus_generation_context(data, "KOBA-001")

    def test_cross_tenant_chunks_are_rejected(self):
        worker.db = FakeFirestore(story_store(cross_tenant=True))
        with self.assertRaisesRegex(worker.PermanentTaskError, "No permitted"):
            worker.retrieve_story_world_knowledge(
                studio_key="KOBA-001", author_id="author_01", universe_id="universe_01",
                reference_guide_id="guide_0001", topic="", target_audience="",
                seo_keywords={}, goal="", max_chunks=10, approved_chunk_ids=["chunk_0001"]
            )

    def test_restricted_spoiler_chunks_are_excluded(self):
        worker.db = FakeFirestore(story_store(include_restricted=True))
        result = worker.retrieve_story_world_knowledge(
            studio_key="KOBA-001", author_id="author_01", universe_id="universe_01",
            reference_guide_id="guide_0001", topic="", target_audience="",
            seo_keywords={}, goal="", max_chunks=10
        )
        self.assertEqual(["chunk_0001"], [chunk["chunkId"] for chunk in result["chunks"]])

    def test_blueprint_strategy_ids_are_validated(self):
        with self.assertRaisesRegex(worker.PermanentTaskError, "primary strategy"):
            worker.select_strategy_guides(
                content_source="story_world", topic="", target_audience="", seo_keywords={},
                requested_goal="create_intrigue", manual_primary_guide_id="invented",
                manual_supporting_guide_id=None
            )
        selected = worker.select_strategy_guides(
            content_source="story_world", topic="", target_audience="", seo_keywords={},
            requested_goal="create_intrigue", manual_primary_guide_id="strategy_intrigue",
            manual_supporting_guide_id="strategy_trust_authority"
        )
        context = worker.fetch_strategy_context(
            selected["primaryGuideId"], selected["supportingGuideId"], "Topic", selected["resolvedGoal"]
        )
        self.assertEqual(["strategy_intrigue", "strategy_trust_authority"], [item["strategyGuideId"] for item in context])

    def test_grounded_prompt_contains_reference_guide_not_legacy_book_context(self):
        story = {
            "world": {"title": "The Lantern Realm", "genre": "Fantasy"},
            "chunks": [{"chunkId": "chunk_0001", "text": "Mara tends the silver harbor lantern."}],
            "guardrails": {"safeToDiscuss": "The harbor", "neverReveal": "Queen Iris is the traitor"},
        }
        with patch.object(worker, "fetch_tier_1_core_library", return_value="CORE"):
            prompt = worker.build_grounded_article_prompt(
                blueprint=nexus_blueprint(), business_context=None, story_context=story,
                strategy_context=worker.fetch_strategy_context("strategy_intrigue", None, "", "create_intrigue")
            )
        self.assertIn("Mara tends the silver harbor lantern", prompt)
        self.assertIn("Queen Iris is the traitor", prompt)

    def test_failed_grounding_raises_permanent_error(self):
        story = {"chunks": [{"text": "Mara tends the silver harbor lantern."}], "guardrails": {"neverReveal": ""}}
        article = dict(nexus_blueprint())
        mapped = {"seo_title": "Unrelated", "seo_description": "Description", "blog_post_html": "<p>Completely unrelated prose about taxation.</p>", "focus_keyword": "tax", "hero_image_prompt": "tax"}
        with self.assertRaisesRegex(worker.PermanentTaskError, "grounding failed"):
            worker.validate_generated_article(blueprint=article, article=mapped, story_context=story)

    def test_failed_spoiler_validation_raises_permanent_error(self):
        story = {
            "chunks": [{"text": "Mara tends the silver harbor lantern."}],
            "guardrails": {"neverReveal": "Queen Iris is the traitor"},
        }
        article = {
            "seo_title": "Harbor Lantern", "seo_description": "Description",
            "blog_post_html": "<p>Mara tends the silver harbor lantern. Queen Iris is the traitor.</p>",
            "focus_keyword": "harbor lantern", "hero_image_prompt": "lantern",
        }
        with self.assertRaisesRegex(worker.PermanentTaskError, "spoiler validation failed"):
            worker.validate_generated_article(blueprint=nexus_blueprint(), article=article, story_context=story)

    def test_failed_validation_blocks_artwork_and_wordpress(self):
        data = nexus_blueprint()
        updates = []
        with patch.object(worker, "acquire_worker_lease", return_value=data), patch.object(
            worker, "resolve_nexus_generation_context", return_value=(None, {"chunks": [], "guardrails": {}}, [])
        ), patch.object(worker, "validate_generated_article", side_effect=worker.PermanentTaskError("grounding failed")), patch.object(
            worker, "update_attempt", side_effect=lambda _r, _a, value: updates.append(value)
        ), patch.object(worker, "generate_featured_image") as image, patch.object(
            worker, "wordpress_session"
        ) as wordpress, patch.object(worker, "stage_wordpress_draft") as stage:
            with self.assertRaises(worker.PermanentTaskError):
                worker.execute_generation("blueprint_001", "attempt_001", "KOBA-001", "https://author.example", "secret")
        image.assert_not_called()
        wordpress.assert_not_called()
        stage.assert_not_called()
        self.assertTrue(any(update.get("groundingStatus") == "failed" for update in updates))
        self.assertFalse(any(update.get("executionState") == "artwork" for update in updates))

    def test_warning_validation_permits_draft_and_records_warnings(self):
        data = nexus_blueprint("business_brand")
        updates = []
        session = FakeWordPressSession("https://author.example")
        warning = {"groundingStatus": "grounded", "canonValidationStatus": "warning", "spoilerValidationStatus": "warning", "warnings": ["Editorial review required"]}
        with patch.object(worker, "acquire_worker_lease", return_value=data), patch.object(
            worker, "resolve_nexus_generation_context", return_value=({"businessName": "KOBA"}, None, [])
        ), patch.object(worker, "validate_generated_article", return_value=warning), patch.object(
            worker, "update_attempt", side_effect=lambda _r, _a, value: updates.append(value)
        ), patch.object(worker, "complete_attempt") as complete, patch.object(
            worker, "wordpress_session", return_value=(session, "https://author.example")
        ), patch.object(worker, "generate_featured_image") as image:
            result = worker.execute_generation("blueprint_001", "attempt_001", "KOBA-001", "https://author.example", "secret")
        self.assertEqual("success", result["status"])
        self.assertTrue(any(update.get("groundingWarnings") == ["Editorial review required"] for update in updates))
        image.assert_not_called()
        complete.assert_called_once()

    def test_successful_story_world_execution_stages_wordpress_draft(self):
        data = nexus_blueprint()
        session = FakeWordPressSession("https://author.example")
        validation = {"groundingStatus": "grounded", "canonValidationStatus": "passed", "spoilerValidationStatus": "passed", "warnings": []}
        with patch.object(worker, "acquire_worker_lease", return_value=data), patch.object(
            worker, "resolve_nexus_generation_context", return_value=(None, {"chunks": [{"text": "Mara lantern harbor"}], "guardrails": {"neverReveal": ""}}, [])
        ), patch.object(worker, "validate_generated_article", return_value=validation), patch.object(
            worker, "update_attempt"
        ), patch.object(worker, "complete_attempt"), patch.object(
            worker, "wordpress_session", return_value=(session, "https://author.example")
        ):
            result = worker.execute_generation("blueprint_001", "attempt_001", "KOBA-001", "https://author.example", "secret")
        self.assertEqual("https://author.example/wp-admin/post.php?post=41&action=edit", result["liveDraftUrl"])
        post_calls = [call for call in session.calls if call[0] == "POST" and "/wp-json/wp/v2/posts" in call[1]]
        self.assertEqual("draft", post_calls[-1][2]["json"]["status"])

    def test_malformed_new_blueprint_cannot_reach_legacy_book_context(self):
        data = nexus_blueprint()
        data.pop("contentSource")
        with patch.object(worker, "acquire_worker_lease", return_value=data), patch.object(
            worker, "fetch_book_context"
        ) as fetch_book, patch.object(worker, "wordpress_session") as wordpress:
            with self.assertRaisesRegex(worker.PermanentTaskError, "contentSource"):
                worker.execute_generation("blueprint_001", "attempt_001", "KOBA-001", "https://author.example", "secret")
        fetch_book.assert_not_called()
        wordpress.assert_not_called()

    def test_only_explicit_legacy_blueprint_uses_legacy_generation(self):
        data = nexus_blueprint()
        data.update({"schemaVersion": 0, "blueprintKind": "legacy_content_blueprint"})
        data.pop("contentSource")
        data.update({"seoTitle": "", "blogPostHtml": "", "focusKeyword": "", "imagePrompt": ""})
        generated = {"seo_title": "Legacy", "seo_description": "Legacy", "blog_post_html": "<p>Legacy</p>", "focus_keyword": "legacy", "facebook_post": "", "instagram_caption": "", "hero_image_prompt": "legacy"}
        session = FakeWordPressSession("https://author.example")
        with patch.object(worker, "acquire_worker_lease", return_value=data), patch.object(
            worker, "generate_article", return_value=generated
        ) as generate, patch.object(worker, "update_attempt"), patch.object(
            worker, "complete_attempt"
        ), patch.object(worker, "wordpress_session", return_value=(session, "https://author.example")), patch.object(
            worker, "generate_featured_image"
        ):
            worker.execute_generation("blueprint_001", "attempt_001", "KOBA-001", "https://author.example", "secret")
        generate.assert_called_once_with(data)

    def test_completed_attempt_deduplication_remains_unchanged(self):
        with patch.object(worker, "acquire_worker_lease", return_value={"_alreadyCompleted": True, "liveDraftUrl": "https://author.example/edit"}), patch.object(
            worker, "resolve_nexus_generation_context"
        ) as resolve:
            result = worker.execute_generation("blueprint_001", "attempt_001", "KOBA-001", "https://author.example", "secret")
        self.assertTrue(result["deduplicated"])
        resolve.assert_not_called()

    def test_audiobook_transcription_routing_remains_unchanged(self):
        payload = json.dumps({"jobType": "audiobook_transcription", "jobId": "job_00001", "transcriptionAttemptId": "attempt_001", "assetId": "asset_0001", "studioKey": "KOBA-001"}).encode()
        with patch.object(worker, "verify_task_request", return_value=payload), patch.object(
            worker, "execute_transcription", return_value={"status": "success"}
        ) as transcription, patch.object(worker, "execute_generation") as generation:
            body, status, _headers = worker.process_blog_topics(FakeRequest())
        self.assertEqual(200, status)
        self.assertEqual("success", json.loads(body)["status"])
        transcription.assert_called_once()
        generation.assert_not_called()

    def test_retry_accounting_remains_unchanged(self):
        payload = json.dumps({"blueprintId": "blueprint_001", "generationAttemptId": "attempt_001", "studioKey": "KOBA-001", "targetWpOrigin": "https://author.example", "secretCredentialRef": "projects/author-jubilee-command-center/secrets/WP_CREDS_TEST/versions/latest"}).encode()
        with patch.object(worker, "verify_task_request", return_value=payload), patch.object(
            worker, "execute_generation", side_effect=RuntimeError("transient")
        ), patch.object(worker, "record_worker_error") as record:
            _body, status, _headers = worker.process_blog_topics(FakeRequest("1"))
        self.assertEqual(500, status)
        self.assertEqual(1, record.call_args.args[3])
        self.assertFalse(record.call_args.args[4])


if __name__ == "__main__":
    unittest.main()

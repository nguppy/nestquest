"""Offline tests for the multi-family calculators (no API key needed)."""

import unittest

from nestquest import multifamily as mf
from nestquest.guard import unverified_amounts


def project(**kw):
    base = dict(state_code="VA", lot_width_ft=220, lot_depth_ft=300, budget_total=6_500_000,
                product="townhomes", avg_rent=3200, unit_types=["2br", "3br"])
    base.update(kw)
    return mf.DevelopmentInput(**base)


def scheme(**kw):
    base = dict(name="Cedar Row", tier="balanced", tagline="t", product="townhomes", buildings=2, stories=3,
                unit_types=[mf.UnitType(name="2BR", bedrooms=2, bathrooms=2.5, area_sqft=1300, count=8),
                            mf.UnitType(name="3BR", bedrooms=3, bathrooms=2.5, area_sqft=1600, count=8)],
                parking_spaces=24, amenities=["playground"], exterior="e", site_notes="n")
    base.update(kw)
    return mf.Scheme(**base)


def labels(ev, status=None):
    return {c["label"] for c in ev["checks"] if status is None or c["status"] == status}


class DevelopmentCalculators(unittest.TestCase):
    def test_balanced_plan_passes(self):
        ev = mf.evaluate_scheme(project(), scheme())
        self.assertFalse(labels(ev, "fail"), ev["checks"])
        self.assertEqual(ev["sizing"]["units"], 16)
        self.assertGreater(ev["returns"]["noi"], 0)

    def test_density_limit(self):
        ev = mf.evaluate_scheme(project(zoning={"max_units_per_acre": 6}), scheme())
        self.assertIn("Exceeds allowed density", labels(ev, "fail"))

    def test_parking_shortfall_warns(self):
        ev = mf.evaluate_scheme(project(parking_per_unit=2), scheme(parking_spaces=10))
        self.assertIn("Less parking than requested", labels(ev, "warn"))

    def test_structured_parking_costs_more_and_uses_no_land(self):
        surf = mf.evaluate_scheme(project(), scheme())
        struct = mf.evaluate_scheme(project(), scheme(parking_type="structured"))
        self.assertGreater(struct["cost"]["parking"], surf["cost"]["parking"])
        self.assertIsNone(struct["layout"]["parking"])

    def test_sale_at_a_loss_fails(self):
        ev = mf.evaluate_scheme(project(exit="sell", avg_rent=None, avg_sale_price=150_000), scheme())
        self.assertIn("Sells at a loss", labels(ev, "fail"))

    def test_site_too_small(self):
        ev = mf.evaluate_scheme(project(lot_width_ft=120, lot_depth_ft=120), scheme())
        self.assertTrue({"Does not fit the site", "Buildings too wide for the site"} & labels(ev, "fail"))

    def test_invented_numbers_caught(self):
        ev = mf.evaluate_scheme(project(), scheme())
        allowed = mf.dev_allowed_amounts([ev], 6_500_000)
        ok = f"Total ${ev['cost']['total']:,} and NOI ${ev['returns']['noi']:,}."
        self.assertEqual(unverified_amounts(ok, allowed), [])
        self.assertEqual(unverified_amounts("Profit will be $2,000,000.", allowed), [2_000_000])


if __name__ == "__main__":
    unittest.main()

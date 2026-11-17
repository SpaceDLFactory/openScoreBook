"""Checks of ortho_fence.py's geometry on made-up walls (no photos needed): python3 -m unittest test_ortho_fence"""
import math, unittest
import ortho_fence as of

def circle_wall(r=100.0, step=0.5, skip=()):
    """rays to a wall that is a circle round home, every step degrees, minus the angles in skip"""
    return {k * step: r for k in range(int(-45 / step), int(45 / step) + 1) if k * step not in skip}

def straight_corner(side, d0=100.0):
    """rays to a straight wall that crosses the foul line at d0 at right angles"""
    return {side * (45 - k / 2): d0 / math.cos(math.radians(k / 2)) for k in range(1, 8)}

class Profile(unittest.TestCase):
    def test_full_wall(self):
        p, how = of.profile(circle_wall())
        self.assertEqual(len(p), 91); self.assertTrue(all(v == 100.0 for v in p)); self.assertEqual(how, 'm' * 91)

    def test_rejects_a_5_degree_hole_even_when_binning_would_hide_it(self):
        # every ray from -2 to +2 missing: rays at -2.5 and +2.5 would fill bins -2 and +2, leaving 3 empty bins
        with self.assertRaises(SystemExit): of.profile(circle_wall(skip={-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2}))

    def test_interpolates_a_short_hole_and_says_so(self):
        p, how = of.profile(circle_wall(skip={9.5, 10, 10.5}))
        self.assertEqual(how[55], 'i'); self.assertEqual(p[55], 100.0)

    def test_rejects_a_wall_not_seen_near_a_pole(self):
        with self.assertRaises(SystemExit): of.profile({a: r for a, r in circle_wall().items() if a > -43.5})

class Pole(unittest.TestCase):
    def test_straight_wall_carried_to_the_line(self):
        v, seen = of.pole(straight_corner(1), 1)
        self.assertFalse(seen); self.assertAlmostEqual(v, 100.0, places=6)

    def test_uses_the_ray_along_the_line_when_it_agrees(self):
        rays = straight_corner(-1); rays[-45.0] = 100.3
        self.assertEqual(of.pole(rays, -1), (100.3, True))

    def test_rejects_a_ray_along_the_line_that_disagrees(self):
        rays = straight_corner(-1); rays[-45.0] = 101.0
        with self.assertRaises(SystemExit): of.pole(rays, -1)

    def test_rejects_a_bent_wall(self):
        rays = straight_corner(1); rays[43.0] += 0.8
        with self.assertRaises(SystemExit): of.pole(rays, 1)

    def test_rejects_a_wall_running_along_the_foul_line(self):
        # a straight wall through the foul line at 100 m, 10 degrees off it: where they meet is ill-conditioned
        q = (100 * math.sin(math.radians(45)), 100 * math.cos(math.radians(45)))
        w = (math.sin(math.radians(35)), math.cos(math.radians(35)))
        rays = {}
        for k in range(1, 7):
            a = 45 - k / 2; v = (math.sin(math.radians(a)), math.cos(math.radians(a)))
            rays[a] = (q[0] * w[1] - q[1] * w[0]) / (v[0] * w[1] - v[1] * w[0])
        with self.assertRaisesRegex(SystemExit, 'parallel'): of.pole(rays, 1)

class Register(unittest.TestCase):
    class Blank:  # a photo of nothing but grass
        mpp = 0.1
        def rgb(self, x, y): return (57, 69, 65)

    def test_chalk_alone_is_not_enough(self):
        with self.assertRaises(SystemExit): of.register(self.Blank(), 1000, 1000, -90, True, lambda *a: None)

    def test_base_paths_need_both_features(self):
        with self.assertRaises(SystemExit): of.register(self.Blank(), 1000, 1000, -90, False, lambda *a: None)

class Area(unittest.TestCase):
    def test_quarter_circle(self):
        # 90 straight chords of a quarter circle of radius 100, plus home: just under pi * 100^2 / 4
        a = of.area([100.0] * 91)
        self.assertAlmostEqual(a, 90 * 0.5 * 100 * 100 * math.sin(math.radians(1)), places=6)

class Corroborate(unittest.TestCase):
    def test_needs_rays_in_every_sector(self):
        p = [100.0] * 91; rays = {a: 100.1 for a in circle_wall() if a < 38}
        self.assertFalse(of.corroborate(p, [(2025, rays)], lambda *a: None))
        self.assertTrue(of.corroborate(p, [(2025, circle_wall(100.1))], lambda *a: None))

    def test_disagreement_fails(self):
        self.assertFalse(of.corroborate([100.0] * 91, [(2025, circle_wall(101.0))], lambda *a: None))

if __name__ == '__main__':
    unittest.main()

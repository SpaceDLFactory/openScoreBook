"""Checks of ortho_fence.py's geometry on made-up walls (no photos needed): python3 -m unittest test_ortho_fence"""
import math, unittest, unittest.mock
import ortho_fence as of

def circle_wall(r=100.0, step=0.5, skip=()):
    """rays to a wall that is a circle round home, every step degrees, minus the angles in skip"""
    return {k * step: r for k in range(int(-45 / step), int(45 / step) + 1) if k * step not in skip}

def straight_corner(side, d0=100.0):
    """rays to a straight wall that crosses the foul line at d0 at right angles"""
    return {side * (45 - k / 2): d0 / math.cos(math.radians(k / 2)) for k in range(1, 8)}

class Profile(unittest.TestCase):
    def test_marks_each_degree_by_the_ray_it_took(self):
        # bin 30 holds 29.5 (agreed, 99), 30.0 (seen once, 101) and 30.5 (seen once, 100): it takes 100 from 30.5
        rays = circle_wall(); rays.update({29.5: 99.0, 30.0: 101.0, 30.5: 100.0})
        p, how = of.profile(rays, once={a for a in rays if a >= 30})
        self.assertEqual((p[75], how[75]), (100.0, 's')); self.assertEqual(how[45], 'm')

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

    def test_base_paths_with_one_feature_are_not_enough(self):
        # a mound found exactly where the rules put it, no infield arc: still not placed
        def one(m, cx, cy, degs, r0, r1, tol): return (cx, cy, 9 * of.FT, 1.0) if r1 < 10 else None
        with unittest.mock.patch.object(of, 'circle', one):
            with self.assertRaisesRegex(SystemExit, '1 rule feature'): of.register(self.Blank(), 1000, 1000, -90, False, lambda *a: None)
            self.assertEqual(of.register(self.Blank(), 1000, 1000, -90, True, lambda *a: None), (1000, 1000))  # with chalk: enough

class Area(unittest.TestCase):
    def test_quarter_circle(self):
        # 90 straight chords of a quarter circle of radius 100, plus home: just under pi * 100^2 / 4
        a = of.area([100.0] * 91)
        self.assertAlmostEqual(a, 90 * 0.5 * 100 * 100 * math.sin(math.radians(1)), places=6)

class Combine(unittest.TestCase):
    log = staticmethod(lambda *a: None)

    def test_agreeing_flights_take_their_median(self):
        rays, once = of.combine([(1, circle_wall(100.0)), (2, circle_wall(100.2)), (3, circle_wall(100.4))], self.log)
        self.assertEqual(set(rays.values()), {100.2}); self.assertEqual(once, set())

    def test_a_flight_outvoted_in_a_sector_is_left_out_there(self):
        # flight 1 reads the left corner 1 m short; 2 and 3 agree there. Its rays only it sees must not be used either.
        short = {a: (99.0 if a < -38 else 100.0) for a in circle_wall()}
        two = {a: v for a, v in circle_wall(100.1).items() if a != -44.0}
        three = {a: v for a, v in circle_wall(100.2).items() if not -45 <= a < -42}
        rays, once = of.combine([(1, short), (2, two), (3, three)], self.log)
        self.assertNotIn(-44.0, rays)  # only flight 1 saw it, and flight 1 is left out of that sector
        self.assertEqual(rays[-44.5], 100.1); self.assertIn(-44.5, once)
        self.assertAlmostEqual(rays[0.0], 100.1)

    def test_one_flight_alone_is_used_and_marked(self):
        lit = circle_wall(100.0); shaded = {a: v for a, v in circle_wall(100.1).items() if a < 25}
        rays, once = of.combine([(1, lit), (2, shaded)], self.log)
        self.assertEqual(rays[30.0], 100.0); self.assertIn(30.0, once); self.assertNotIn(0.0, once)

    def test_agreeing_once_does_not_excuse_disagreeing(self):
        # A agrees with B at 0, reads 5 m off B and C at 1, and alone offers 95 m at 2: A is left out of the sector
        a = {0.0: 100.0, 1.0: 105.0, 2.0: 95.0}; b = {0.0: 100.1, 1.0: 100.0}; c = {1.0: 100.2}
        rays, once = of.combine([('A', a), ('B', b), ('C', c)], self.log)
        self.assertNotIn(2.0, rays); self.assertAlmostEqual(rays[1.0], 100.1)

    def test_two_equally_supported_readings_drop_the_ray(self):
        rays, _ = of.combine([(1, {0.0: 95.0}), (2, {0.0: 95.1}), (3, {0.0: 100.0}), (4, {0.0: 100.1})], self.log)
        self.assertNotIn(0.0, rays)

    def test_disagreement_with_no_one_to_settle_it_drops_the_ray(self):
        rays, _ = of.combine([(1, circle_wall(100.0)), (2, circle_wall(101.0))], self.log)
        self.assertEqual(rays, {})

if __name__ == '__main__':
    unittest.main()

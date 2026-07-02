import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import devAuthRouter from "./dev-auth";
import resetAdminPasswordRouter from "./admin/reset-admin-password";
import publicRouter from "./public";
import engagementRouter from "./engagement";
import meRouter from "./me";
import writerRouter from "./writer";
import adminRouter from "./admin";
import adminModularRouter from "./admin/index";
import seoRouter from "./seo";
import uploadRouter from "./upload";

const router: IRouter = Router();

router.use(healthRouter);
router.use(resetAdminPasswordRouter);
router.use(devAuthRouter);
router.use(authRouter);
router.use(publicRouter);
router.use(engagementRouter);
router.use(meRouter);
router.use(writerRouter);
router.use(adminRouter);
router.use(adminModularRouter);
router.use(seoRouter);
router.use(uploadRouter);

export default router;

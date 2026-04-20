// src/routes/erp.js
const router = require('express').Router();
const multer = require('multer');
const path   = require('path');
const { v4: uuid } = require('uuid');
const { authenticate } = require('../middleware/auth');
const { authorize }    = require('../middleware/rbac');
const C = require('../controllers/erpController');

// Document upload
const docStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/documents/'),
  filename:    (req, file, cb) => cb(null, `${uuid()}${path.extname(file.originalname)}`),
});
const uploadDoc = multer({ storage: docStorage, limits: { fileSize: 50 * 1024 * 1024 } });

router.use(authenticate);

// ERP summary (analytics)
router.get('/summary', authorize('SUPER_ADMIN','ADMIN','MANAGER'), C.getErpSummary);

// Products
router.get('/products',       C.getProducts);
router.post('/products',      authorize('SUPER_ADMIN','ADMIN','MANAGER'), C.createProduct);
router.put('/products/:id',   authorize('SUPER_ADMIN','ADMIN','MANAGER'), C.updateProduct);
router.delete('/products/:id',authorize('SUPER_ADMIN','ADMIN'), C.deleteProduct);

// Buyers
router.get('/buyers',       C.getBuyers);
router.post('/buyers',      authorize('SUPER_ADMIN','ADMIN','MANAGER'), C.createBuyer);
router.put('/buyers/:id',   authorize('SUPER_ADMIN','ADMIN','MANAGER'), C.updateBuyer);

// Suppliers
router.get('/suppliers',       C.getSuppliers);
router.post('/suppliers',      authorize('SUPER_ADMIN','ADMIN','MANAGER'), C.createSupplier);
router.put('/suppliers/:id',   authorize('SUPER_ADMIN','ADMIN','MANAGER'), C.updateSupplier);

// Shipments
router.get('/shipments',        C.getShipments);
router.get('/shipments/:id',    C.getShipment);
router.post('/shipments',       authorize('SUPER_ADMIN','ADMIN','MANAGER'), C.createShipment);
router.put('/shipments/:id',    authorize('SUPER_ADMIN','ADMIN','MANAGER'), C.updateShipment);

// Payments
router.get('/payments',       authorize('SUPER_ADMIN','ADMIN','MANAGER'), C.getPayments);
router.post('/payments',      authorize('SUPER_ADMIN','ADMIN','MANAGER'), C.createPayment);
router.put('/payments/:id',   authorize('SUPER_ADMIN','ADMIN','MANAGER'), C.updatePayment);

// Documents
router.get('/documents',                        C.getDocuments);
router.post('/documents', uploadDoc.single('file'), C.uploadDocument);

module.exports = router;

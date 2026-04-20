// src/controllers/erpController.js
const { PrismaClient } = require('@prisma/client');
const { createAuditLog } = require('../services/auditService');
const logger = require('../utils/logger');
const fs     = require('fs');

const prisma = new PrismaClient();
const orgId  = (req) => req.user.organizationId;

// ════════════════════════════════════════════════════════════
// PRODUCTS
// ════════════════════════════════════════════════════════════

const getProducts = async (req, res) => {
  try {
    const { search, category, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = {
      organizationId: orgId(req),
      ...(search && { name: { contains: search, mode: 'insensitive' } }),
      ...(category && { category }),
    };
    const [products, total] = await Promise.all([
      prisma.product.findMany({ where, skip, take: parseInt(limit), orderBy: { name: 'asc' } }),
      prisma.product.count({ where }),
    ]);
    res.json({ success: true, data: products, pagination: { total, page: parseInt(page), limit: parseInt(limit) } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

const createProduct = async (req, res) => {
  try {
    const { name, sku, category, description, unit, pricePerUnit, stockQuantity, minStockLevel } = req.body;
    if (!name || !pricePerUnit) return res.status(400).json({ success: false, message: 'Name and price are required' });
    const product = await prisma.product.create({
      data: { name, sku, category, description, unit: unit || 'KG', pricePerUnit: parseFloat(pricePerUnit), stockQuantity: parseFloat(stockQuantity || 0), minStockLevel: parseFloat(minStockLevel || 0), organizationId: orgId(req) },
    });
    await createAuditLog(req.user.id, orgId(req), `Created product: ${name}`);
    res.status(201).json({ success: true, data: product });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await prisma.product.update({
      where: { id: parseInt(id) },
      data: { ...req.body, pricePerUnit: req.body.pricePerUnit ? parseFloat(req.body.pricePerUnit) : undefined, stockQuantity: req.body.stockQuantity ? parseFloat(req.body.stockQuantity) : undefined },
    });
    res.json({ success: true, data: product });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

const deleteProduct = async (req, res) => {
  try {
    await prisma.product.update({ where: { id: parseInt(req.params.id) }, data: { isActive: false } });
    res.json({ success: true, message: 'Product deactivated' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ════════════════════════════════════════════════════════════
// BUYERS
// ════════════════════════════════════════════════════════════

const getBuyers = async (req, res) => {
  try {
    const { search } = req.query;
    const buyers = await prisma.buyer.findMany({
      where: { organizationId: orgId(req), isActive: true, ...(search && { OR: [{ name: { contains: search, mode: 'insensitive' } }, { company: { contains: search, mode: 'insensitive' } }] }) },
      include: { _count: { select: { shipments: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: buyers });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

const createBuyer = async (req, res) => {
  try {
    const buyer = await prisma.buyer.create({ data: { ...req.body, organizationId: orgId(req) } });
    await createAuditLog(req.user.id, orgId(req), `Created buyer: ${buyer.name}`);
    res.status(201).json({ success: true, data: buyer });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

const updateBuyer = async (req, res) => {
  try {
    const buyer = await prisma.buyer.update({ where: { id: parseInt(req.params.id) }, data: req.body });
    res.json({ success: true, data: buyer });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ════════════════════════════════════════════════════════════
// SUPPLIERS
// ════════════════════════════════════════════════════════════

const getSuppliers = async (req, res) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      where: { organizationId: orgId(req), isActive: true },
      include: { _count: { select: { shipments: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: suppliers });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

const createSupplier = async (req, res) => {
  try {
    const supplier = await prisma.supplier.create({ data: { ...req.body, organizationId: orgId(req) } });
    await createAuditLog(req.user.id, orgId(req), `Created supplier: ${supplier.name}`);
    res.status(201).json({ success: true, data: supplier });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

const updateSupplier = async (req, res) => {
  try {
    const s = await prisma.supplier.update({ where: { id: parseInt(req.params.id) }, data: req.body });
    res.json({ success: true, data: s });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ════════════════════════════════════════════════════════════
// SHIPMENTS
// ════════════════════════════════════════════════════════════

const getShipments = async (req, res) => {
  try {
    const { status, buyerId, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = {
      organizationId: orgId(req),
      ...(status && { status }),
      ...(buyerId && { buyerId: parseInt(buyerId) }),
    };
    const [shipments, total] = await Promise.all([
      prisma.shipment.findMany({
        where, skip, take: parseInt(limit),
        include: {
          buyer: { select: { id: true, name: true, company: true, country: true } },
          supplier: { select: { id: true, name: true, company: true } },
          items: { include: { product: { select: { id: true, name: true, unit: true } } } },
          _count: { select: { documents: true, payments: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.shipment.count({ where }),
    ]);
    res.json({ success: true, data: shipments, pagination: { total, page: parseInt(page), limit: parseInt(limit) } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

const getShipment = async (req, res) => {
  try {
    const shipment = await prisma.shipment.findFirst({
      where: { id: parseInt(req.params.id), organizationId: orgId(req) },
      include: {
        buyer: true, supplier: true,
        items: { include: { product: true } },
        documents: true,
        payments: true,
      },
    });
    if (!shipment) return res.status(404).json({ success: false, message: 'Shipment not found' });
    res.json({ success: true, data: shipment });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

const createShipment = async (req, res) => {
  try {
    const { buyerId, supplierId, origin, destination, containerType, items = [], ...rest } = req.body;
    if (!buyerId || !destination) return res.status(400).json({ success: false, message: 'Buyer and destination are required' });

    // Generate shipment number
    const year = new Date().getFullYear();
    const count = await prisma.shipment.count({ where: { organizationId: orgId(req) } });
    const shipmentNumber = `ATZ-${year}-${String(count + 1).padStart(4, '0')}`;

    // Calculate totals from items
    const totalItemValue = items.reduce((s, i) => s + (parseFloat(i.quantity) * parseFloat(i.unitPrice)), 0);

    const shipment = await prisma.shipment.create({
      data: {
        shipmentNumber,
        buyerId: parseInt(buyerId),
        supplierId: supplierId ? parseInt(supplierId) : null,
        organizationId: orgId(req),
        origin: origin || 'India',
        destination,
        containerType,
        invoiceValue: totalItemValue,
        ...rest,
        items: {
          create: items.map(item => ({
            productId:  parseInt(item.productId),
            quantity:   parseFloat(item.quantity),
            unit:       item.unit,
            unitPrice:  parseFloat(item.unitPrice),
            totalPrice: parseFloat(item.quantity) * parseFloat(item.unitPrice),
            description: item.description,
          })),
        },
      },
      include: {
        buyer: true, supplier: true,
        items: { include: { product: true } },
      },
    });

    await createAuditLog(req.user.id, orgId(req), `Created shipment: ${shipmentNumber}`);
    res.status(201).json({ success: true, data: shipment });
  } catch (err) {
    logger.error('createShipment error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateShipment = async (req, res) => {
  try {
    const { id } = req.params;
    const { items, ...data } = req.body;

    // Auto-compute profit if costs and price provided
    if (data.sellingPrice && data.totalCost) {
      data.profit = parseFloat(data.sellingPrice) - parseFloat(data.totalCost);
    }

    const shipment = await prisma.shipment.update({
      where: { id: parseInt(id) },
      data,
      include: { buyer: true, supplier: true, items: { include: { product: true } } },
    });
    await createAuditLog(req.user.id, orgId(req), `Updated shipment: ${shipment.shipmentNumber}`);
    res.json({ success: true, data: shipment });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ════════════════════════════════════════════════════════════
// PAYMENTS
// ════════════════════════════════════════════════════════════

const getPayments = async (req, res) => {
  try {
    const { status, shipmentId } = req.query;
    const payments = await prisma.payment.findMany({
      where: { organizationId: orgId(req), ...(status && { status }), ...(shipmentId && { shipmentId: parseInt(shipmentId) }) },
      include: {
        buyer: { select: { id: true, name: true, company: true } },
        shipment: { select: { id: true, shipmentNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: payments });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

const createPayment = async (req, res) => {
  try {
    const { shipmentId, buyerId, amount, currency, paymentDate, dueDate, method, reference, notes } = req.body;
    if (!amount) return res.status(400).json({ success: false, message: 'Amount is required' });

    const payment = await prisma.payment.create({
      data: {
        shipmentId: shipmentId ? parseInt(shipmentId) : null,
        buyerId:    buyerId    ? parseInt(buyerId)    : null,
        organizationId: orgId(req),
        amount: parseFloat(amount),
        currency: currency || 'USD',
        paymentDate: paymentDate ? new Date(paymentDate) : null,
        dueDate:     dueDate     ? new Date(dueDate)     : null,
        method, reference, notes,
      },
    });

    // Update shipment payment status
    if (shipmentId) {
      const allPayments = await prisma.payment.findMany({
        where: { shipmentId: parseInt(shipmentId) },
        select: { amount: true, status: true },
      });
      const shipment = await prisma.shipment.findUnique({ where: { id: parseInt(shipmentId) }, select: { sellingPrice: true } });
      const paid = allPayments.filter(p => p.status === 'PAID').reduce((s, p) => s + p.amount, 0) + parseFloat(amount);
      const newStatus = shipment?.sellingPrice && paid >= shipment.sellingPrice ? 'PAID' : paid > 0 ? 'PARTIAL' : 'PENDING';
      await prisma.shipment.update({ where: { id: parseInt(shipmentId) }, data: { paymentStatus: newStatus } });
    }

    res.status(201).json({ success: true, data: payment });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

const updatePayment = async (req, res) => {
  try {
    const payment = await prisma.payment.update({
      where: { id: parseInt(req.params.id) },
      data: { ...req.body, amount: req.body.amount ? parseFloat(req.body.amount) : undefined },
    });
    res.json({ success: true, data: payment });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ════════════════════════════════════════════════════════════
// DOCUMENTS
// ════════════════════════════════════════════════════════════

const uploadDocument = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const { title, type, shipmentId, notes } = req.body;
    const doc = await prisma.document.create({
      data: {
        title:         title || req.file.originalname,
        type:          type || 'OTHER',
        fileUrl:       `/uploads/documents/${req.file.filename}`,
        fileName:      req.file.originalname,
        fileSize:      req.file.size,
        mimeType:      req.file.mimetype,
        shipmentId:    shipmentId ? parseInt(shipmentId) : null,
        organizationId: orgId(req),
        uploadedById:  req.user.id,
        notes,
      },
    });
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch { /* ignore */ } }
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDocuments = async (req, res) => {
  try {
    const { shipmentId, type } = req.query;
    const docs = await prisma.document.findMany({
      where: { organizationId: orgId(req), ...(shipmentId && { shipmentId: parseInt(shipmentId) }), ...(type && { type }) },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: docs });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ════════════════════════════════════════════════════════════
// ERP ANALYTICS
// ════════════════════════════════════════════════════════════

const getErpSummary = async (req, res) => {
  try {
    const oId = orgId(req);
    const [
      totalShipments, activeShipments, totalRevenue, totalProfit,
      pendingPayments, productCount, buyerCount,
    ] = await Promise.all([
      prisma.shipment.count({ where: { organizationId: oId } }),
      prisma.shipment.count({ where: { organizationId: oId, status: { in: ['CONFIRMED', 'IN_TRANSIT'] } } }),
      prisma.shipment.aggregate({ where: { organizationId: oId, status: 'DELIVERED' }, _sum: { sellingPrice: true } }),
      prisma.shipment.aggregate({ where: { organizationId: oId, status: 'DELIVERED' }, _sum: { profit: true } }),
      prisma.payment.count({ where: { organizationId: oId, status: 'PENDING' } }),
      prisma.product.count({ where: { organizationId: oId, isActive: true } }),
      prisma.buyer.count({ where: { organizationId: oId, isActive: true } }),
    ]);

    // Monthly shipment trend (last 6 months)
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const count = await prisma.shipment.count({ where: { organizationId: oId, createdAt: { gte: start, lte: end } } });
      const rev   = await prisma.shipment.aggregate({ where: { organizationId: oId, createdAt: { gte: start, lte: end }, status: 'DELIVERED' }, _sum: { sellingPrice: true } });
      months.push({
        month: d.toLocaleString('en-IN', { month: 'short' }),
        shipments: count,
        revenue: rev._sum.sellingPrice || 0,
      });
    }

    res.json({
      success: true,
      data: {
        totalShipments, activeShipments, pendingPayments,
        productCount, buyerCount,
        totalRevenue: totalRevenue._sum.sellingPrice || 0,
        totalProfit:  totalProfit._sum.profit || 0,
        monthlyTrend: months,
      },
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

module.exports = {
  getProducts, createProduct, updateProduct, deleteProduct,
  getBuyers, createBuyer, updateBuyer,
  getSuppliers, createSupplier, updateSupplier,
  getShipments, getShipment, createShipment, updateShipment,
  getPayments, createPayment, updatePayment,
  uploadDocument, getDocuments,
  getErpSummary,
};

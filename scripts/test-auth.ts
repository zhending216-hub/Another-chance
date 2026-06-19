import prisma from '../src/lib/prisma';

async function testAuth() {
  try {
    // 测试数据库连接
    console.log('测试数据库连接...');
    await prisma.$connect();
    console.log('✓ 数据库连接成功');

    // 查看用户表
    const userCount = await prisma.user.count();
    console.log(`✓ 用户表存在，当前有 ${userCount} 个用户`);

    // 尝试创建测试用户
    const testEmail = `test_${Date.now()}@example.com`;
    console.log(`尝试创建测试用户: ${testEmail}...`);

    const testUser = await prisma.user.create({
      data: {
        name: '测试用户',
        email: testEmail,
        passwordHash: '$2a$12$test', // 测试哈希
      },
    });
    console.log('✓ 创建用户成功:', testUser);

    // 删除测试用户
    await prisma.user.delete({ where: { id: testUser.id } });
    console.log('✓ 删除测试用户成功');

    console.log('\n所有认证相关测试通过！');
  } catch (error) {
    console.error('❌ 测试失败:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testAuth();
